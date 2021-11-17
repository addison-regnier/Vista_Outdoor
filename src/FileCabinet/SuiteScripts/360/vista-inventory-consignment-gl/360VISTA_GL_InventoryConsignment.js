/**
 * Custom GL Plugin for Intercompany Sales Orders Fulfillment to adjust the Consigned Inventory.
 *
 * @copyright 2021, 360 Cloud Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */

/**
 * Reverse natural lines and debit the Inventory Consignment Account.
 *
 * @param {Object} pRec
 * @param {Object} pStdLines
 * @param {Object} pCustLines
 */
function handleInventoryConsignment(pRec, pStdLines, pCustLines) {

    /* Getting Company Preference Inventory Consignment Account */
    var sInventoryConsignmentAccount = nlapiGetContext().getPreference('custscript_360_ue_inter_je_consigned_acc');
    if (!sInventoryConsignmentAccount) {

        nlapiLogExecution(
            'audit',
            'No Inventory Consignment Account',
            'Skipping Custom GL Impact, no Inventory Consignment Account found, verify your company preferences.'
        );

        return;
    }

    var aLines = [];
    var stdLines = pStdLines.getCount();

    /* Looping all Lines to get the Standard Lines */
    for (var nLine = 0; nLine < stdLines; nLine++) {

        var oStdLine = pStdLines.getLine(nLine);

        /* Skipping not posting lines and line with null account */
        if (!oStdLine.isPosting() || oStdLine.getAccountId() === null || oStdLine.getAccountId() === '') {

            continue;
        }

        var oLineData = {
            credit: oStdLine.getCreditAmount(),
            debit: oStdLine.getDebitAmount(),
            account: oStdLine.getAccountId(),
            class: oStdLine.getClassId(),
            department: oStdLine.getDepartmentId(),
            entity: oStdLine.getEntityId(),
            location: oStdLine.getLocationId(),
        };

        if (Number(oLineData.debit) === 0 && Number(oLineData.credit) === 0) {

            continue;
        }

        aLines.push(oLineData)
    }

    /* Looping selected Lines to reverse Standard Lines */
    for (var nLine = 0; nLine < aLines.length; nLine++) {

        var oCurrentLine = aLines[nLine];

        /* Reversing the natural Debit Line */
        if (Boolean(Number(oCurrentLine.debit))) {

            var custCreditLine = pCustLines.addNewLine();
            custCreditLine.setAccountId(Number(oCurrentLine.account));

            if (oCurrentLine.class) {

                custCreditLine.setClassId(Number(oCurrentLine.class));
            }

            if (oCurrentLine.department) {

                custCreditLine.setDepartmentId(Number(oCurrentLine.department));
            }
            if (oCurrentLine.location) {

                custCreditLine.setLocationId(Number(oCurrentLine.location));
            }

            if (oCurrentLine.entity) {

                custCreditLine.setEntityId(Number(oCurrentLine.entity));
            }

            custCreditLine.setCreditAmount(Number(oCurrentLine.debit));

            /* Adding Custom Debit Line */
            var custDebitLine = pCustLines.addNewLine();

            custDebitLine.setAccountId(Number(sInventoryConsignmentAccount));

            if (oCurrentLine.class) {

                custDebitLine.setClassId(Number(oCurrentLine.class));
            }

            if (oCurrentLine.department) {

                custDebitLine.setDepartmentId(Number(oCurrentLine.department));
            }
            if (oCurrentLine.location) {

                custDebitLine.setLocationId(Number(oCurrentLine.location));
            }

            if (oCurrentLine.entity) {

                custDebitLine.setEntityId(Number(oCurrentLine.entity));
            }

            custDebitLine.setDebitAmount(Number(oCurrentLine.debit));
        }
    }
}

/**
 *
 * Custom GL Plugin Entry Point.
 *
 * @param  {Object} pRec
 * @param  {Object} oStdLines
 * @param  {Object} oCustLines
 * @param  {Object} oBook
 */
function customizeGlImpact(pRec, oStdLines, oCustLines, oBook) {

    if (Boolean(!oBook.isPrimary())) {

        nlapiLogExecution('error', 'Accounting Book', 'Multiple Books not supported');

        return;
    }

    /* Getting the created from id (Transfer Order) */
    var sRecFrom = pRec.getFieldValue('createdfrom');

    /* If there is no Created From value something is really wrong, we log an error and return */
    if (Boolean(!sRecFrom)) {

        nlapiLogExecution(
            'error',
            'No Fulfillment Created From',
            'Unable to continue without Fulfillment created from.'
        );

        return;
    }

    nlapiLogExecution(
        'audit',
        'Created From',
        sRecFrom
    );

    /* Checking the Created From Record Type to make sure it is a Transfer Order */
    var oRecFromLookup = nlapiLookupField('transaction', Number(sRecFrom), ['recordtype', 'subsidiary', 'tosubsidiary']);

    if (oRecFromLookup.recordtype !== 'transferorder' || (!oRecFromLookup.subsidiary || !oRecFromLookup.tosubsidiary)) {

        nlapiLogExecution(
            'audit',
            'Not Created From Intercompany Transfer Order',
            'This fulfillment was not created from a Intercompany Transfer Order, skipping.'
        );

        return;
    }

    /* Only updating GL Lines if the To Subsidiary is Vista Outdoor Sales, LLC (Partial) (ID 17) */
    if (oRecFromLookup.tosubsidiary !== '17') {

        return;
    }

    /* Checking if the Fulfillment Status is Shipped */
    var sStatus = pRec.getFieldValue('shipstatus');

    if (sStatus !== 'C') {

        return;
    }

    handleInventoryConsignment(pRec, oStdLines, oCustLines);
}