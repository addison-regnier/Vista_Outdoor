/**
 *
 * Custom GL Plugin on Item Fulfillment transactions
 *
 * @copyright 2021, 360 Cloud Solutions, LLC
 * @author Raul R Alpizar <ralpizargamboa@360cloudsolutions.com>
 *
 */

/**
 * Custom GL Plugin Entry Point.
 *
 * @param  {Object} oIFRec
 * @param  {Object} oStdLines
 * @param  {Object} oCustLines
 * @param  {Object} oBook
 */
function customizeGlImpact(oIFRec, oStdLines, oCustomLines, oBook) {

    if (Boolean(!oBook.isPrimary())) {

        nlapiLogExecution('error', 'Accounting Book', 'Multiple Books not supported');

        return;
    }

    // Getting the created from id (Purchase Order)
    var oIFFrom = oIFRec.getFieldValue("createdfrom");

    if (Boolean(!oIFFrom)) {

        nlapiLogExecution(
            'error',
            'No Item Fulfillment Created From',
            'Unable to continue without Item Fulfillment created from.'
        );

        return;
    }

    // Checking the Created From Record Type to make sure is a Transfer Order
    var fromType = nlapiLookupField('transaction', Number(oIFFrom), ['recordtype']);
    if (fromType.recordtype !== 'transferorder') {

        nlapiLogExecution('audit', 'Firing on IF' + oIFRec.id, 'Not created from a transfer order');

        return;
    }

    var sSubsidiary = nlapiLookupField('transferorder', Number(oIFFrom), 'subsidiary');
    var sToSubsidiary = nlapiLookupField('transferorder', Number(oIFFrom), 'tosubsidiary');
    var sShipStatus = oIFRec.getFieldValue("shipstatus");

    var bValidToContinue = true;

    // Vista Sales LLC ID = 17
    if (Boolean(sSubsidiary !== '17')) {

        nlapiLogExecution(
            'audit',
            'Wrong Subsidiary',
            'Unable to continue, subsidiary need to be Vista Sales LLC.'
        );
        bValidToContinue = false;
    }

    // Vista Sales LLC ID = 17
    if (Boolean(sToSubsidiary === '17')) {

        nlapiLogExecution(
            'audit',
            'Wrong To Subsidiary',
            'Unable to continue, to subsidiary need to be different to Vista Sales LLC.'
        );
        bValidToContinue = false;
    }

    // Shipped = C
    if (Boolean(sShipStatus !== 'C')) {

        return;
    }

    if (Boolean(!bValidToContinue)) {

        return;
    }

    reverseGLImpact(oStdLines, oCustomLines);

}

/**
 *
 * This function will reverse the GL Impact for the Standard Lines
 *
 * @param {Object} oLineData
 * @param {Object} paramStdLines
 * @param {Object} paramCustLines
 * @param {number} paramExpectedValue
 *
 */
function reverseGLImpact(paramStdLines, paramCustomLines) {

    var aLines = [];
    var stdLines = paramStdLines.getCount();

    /* Looping all Lines to get the Standard Lines */
    for (var nLine = 0; nLine < stdLines; nLine++) {

        var oStdLine = paramStdLines.getLine(nLine);

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

        var oCurrLine = aLines[nLine];
        var custLine = paramCustomLines.addNewLine();

        custLine.setAccountId(Number(oCurrLine.account));

        if (oCurrLine.class) {

            custLine.setClassId(Number(oCurrLine.class));
        }
        if (oCurrLine.department) {

            custLine.setDepartmentId(Number(oCurrLine.department));
        }
        if (oCurrLine.location) {

            custLine.setLocationId(Number(oCurrLine.location));
        }
        if (oCurrLine.entity) {

            custLine.setEntityId(Number(oCurrLine.entity));
        }

        if (Boolean(!Number(oCurrLine.credit))) {

            custLine.setCreditAmount(Number(oCurrLine.debit));
        } else {

            custLine.setDebitAmount(Number(oCurrLine.credit));
        }
    }

}
