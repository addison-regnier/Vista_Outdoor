/**
 *
 * Custom GL Plugin on Item Receipt transactions
 *
 * @copyright 2021, 360 Cloud Solutions, LLC
 * @author Raul R Alpizar <ralpizargamboa@360cloudsolutions.com>
 *
 */

/**
 * Custom GL Plugin Entry Point.
 *
 * @param  {Object} oIRRec
 * @param  {Object} oStdLines
 * @param  {Object} oCustLines
 * @param  {Object} oBook
 */
function customizeGlImpact(oIRRec, oStdLines, oCustLines, oBook) {

    if (Boolean(!oBook.isPrimary())) {

        nlapiLogExecution('error', 'Accounting Book', 'Multiple Books not supported');

        return;
    }

    // Getting the created from id (Purchase Order)
    var oIRFrom = oIRRec.getFieldValue("createdfrom");

    if (Boolean(!oIRFrom)) {

        nlapiLogExecution(
            'error',
            'No Item Receipt Created From',
            'Unable to continue without Item Receipt created from.'
        );

        return;
    }

    // Checking the Created From Record Type to make sure is a Transfer Order
    var fromType = nlapiLookupField('transaction', Number(oIRFrom), ['recordtype']);
    if (fromType.recordtype !== 'transferorder') {

        nlapiLogExecution('audit', 'Firing on IR' + oIRRec.id, 'Not created from a transfer order');

        return;
    }

    var paramRec = nlapiLoadRecord("transferorder", oIRFrom);

    var sSubsidiary = paramRec.getFieldValue("subsidiary");
    var sToSubsidiary = paramRec.getFieldValue("tosubsidiary");

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

    if (Boolean(!bValidToContinue)) {

        return;
    }

    // Intercompany Payable Internal ID = 202100
    var sIntercompanyPayableAccountID = "750";

    // Consigned Inventory Account: 139998
    var sConsignedInventoryAccountID = "1264";

    var nSubLinesCount = oIRRec.getLineItemCount('item');

    var oStandardCost  = getStandardCost(oIRRec, nSubLinesCount);

    nlapiLogExecution(
        'debug',
        'oStandardCost',
        'oStandardCost: ' + JSON.stringify(oStandardCost)
    );

    for (var nLine = 1; nLine <= nSubLinesCount; nLine++) {

        var sItemInternalId = paramRec.getLineItemValue('item', 'item', nLine);

        var nStandardCost = oStandardCost[sItemInternalId];
        if (Boolean(!nStandardCost)) {

            continue;
        }

        var nQuantity = oIRRec.getLineItemValue('item', 'quantity', nLine);
        var nValue = nStandardCost * Number(nQuantity);

        var sDepartment = paramRec.getFieldValue("department");
        var sClass = paramRec.getFieldValue("class");
        var sLocation = paramRec.getFieldValue("location");

        var oLineData = {
            debitAccount: sConsignedInventoryAccountID,
            creditAccount: sIntercompanyPayableAccountID,
            department: sDepartment,
            class: sClass,
            location: sLocation,
            value: nValue
        }

        if (Boolean(!sIntercompanyPayableAccountID) || Boolean(!sConsignedInventoryAccountID)) {

            nlapiLogExecution(
                'debug',
                'No Finished Goods or Consigned Inventory',
                'Skipping Custom GL Impact, no Finished Goods or Consigned Inventory.'
            );

            return;
        }

        reverseGLImpact(oLineData, oStdLines, oCustLines);
    }
}

/**
 * Look up the standard cost of the items included on the item receipt
 *
 * @param {Object} paramRec
 * @param {number} nSubLinesCount
 *
 * @return {Object}
 */
function getStandardCost(paramRec, nSubLinesCount) {

    var sLocationId;
    var aItemIds = [];

    for (var nLine = 1; nLine <= nSubLinesCount; nLine++) {

        var sItemInternalId = paramRec.getLineItemValue('item', 'item', nLine);

        if (!sLocationId) {

            sLocationId = paramRec.getLineItemValue('item', 'location', nLine);
        }

        aItemIds.push(sItemInternalId);
    }

    var oStandardCost = {};
    var columns = [];
    columns.push(
        new nlobjSearchColumn('locationcost')
    );
    var oItemCost = nlapiSearchRecord('item',null,
        [
            ['internalid','anyof',aItemIds], // array of item internal ids
            'AND',
            ['inventorylocation','anyof', sLocationId] // the location of the item record
        ],
        columns
    );

    oItemCost.forEach(function (oResult) {

        var sLocationCost = oResult.getValue('locationcost');
        if (Boolean(sLocationCost)) {

            oStandardCost[oResult.getId()] = Number(sLocationCost);
        }
    });

    return oStandardCost;
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
function reverseGLImpact(oLineData, paramStdLines, paramCustLines) {

    var custDebitLine = paramCustLines.addNewLine();

    /* Debiting the Asset Holding Account for Procurements in Progress */
    custDebitLine.setAccountId(Number(oLineData.debitAccount));
    custDebitLine.setDebitAmount(Number(oLineData.value));

    var custCreditLine = paramCustLines.addNewLine();

    /* Crediting the Liability Holding Account for Procurements in Progress */
    custCreditLine.setAccountId(Number(oLineData.creditAccount));
    custCreditLine.setCreditAmount(Number(oLineData.value));
}
