/**
 * This Custom GL Plugin for Item Fulfillment credit the Items COGS and Intercompany Payable Accounts considering
 * the Item Line Custom Cost.
 *
 * @copyright 2021, 360 Cloud Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */

/**
 * Custom GL Plugin Entry Point.
 *
 * @param  {Object} oRec
 * @param  {Object} oStdLines
 * @param  {Object} oCustLines
 * @param  {Object} oBook
 */
function customizeGlImpact(oRec, oStdLines, oCustLines, oBook) {

    /* Getting the created from id (Sales Order) */
    var recFrom = oRec.getFieldValue('createdfrom');

    /* If there is no Created From value something is really wrong, we log an error and return. */
    if (Boolean(!recFrom)) {

        nlapiLogExecution(
            'error',
            'No Fulfillment Created From',
            'Unable to continue without fulfillment created from.'
        );

        return;
    }

    /* Checking the Created From Record Type to make sure is a Sales Order */
    var fromType = nlapiLookupField('transaction', Number(recFrom), ['recordtype']);
    if (fromType.recordtype !== 'salesorder') {

        nlapiLogExecution('audit', 'Exiting now', 'Not created from a sales order');

        return;
    }

    /* Checking if the Fulfillment Status is Shipped */
    var sStatus = oRec.getFieldValue('shipstatus');
    if (sStatus === 'C') {

        addCustomLines(oRec, oStdLines, oCustLines);
    }
}

/**
 *
 * This function is going to DEBIT the Item's COGS account and CREDIT the Intercompany Payable account.
 *
 * @param {Object} pRec
 * @param {Object} pStdLines
 * @param {Object} pCustLines
 *
 */
function addCustomLines(pRec, pStdLines, pCustLines) {

    /* Getting the Fulfilled Lines Data and adding the COGS Account per Item */
    var oFulfilledLinesData = getFulfilledItems(pRec);

    oFulfilledLinesData = addAccountToLineItems(oFulfilledLinesData);

    nlapiLogExecution('audit', 'Adding Custom Lines', JSON.stringify(oFulfilledLinesData));

    /* Getting the Intercompany Payable Account */
    var sInterPayable = nlapiGetContext().getPreference('custscript_360_int_company_paccount');
    if (!sInterPayable) {

        return;
    }

    /* Crediting and Debiting each fulfilled line using the corresponding stdLine Data */
    oFulfilledLinesData.forEach(function (oLineData) {

        if (!oLineData.COGS_ACCOUNT || Number(oLineData.CUSTOM_COST) === 0) {

            return;
        }

        /* Creating Custom Line to DEBIT the COGS Account */
        var custCOGS = pCustLines.addNewLine();

        /* Debiting the COGS Account */
        custCOGS.setAccountId(Number(oLineData.COGS_ACCOUNT));
        if (oLineData.CLASS) {
            custCOGS.setClassId(Number(oLineData.CLASS));
        }
        if (oLineData.DEPARTMENT) {
            custCOGS.setDepartmentId(Number(oLineData.DEPARTMENT));
        }
        if (oLineData.LOCATION) {
            custCOGS.setLocationId(Number(oLineData.LOCATION));
        }
        custCOGS.setDebitAmount(Number(oLineData.CUSTOM_COST) * Number(oLineData.QUANTITY));

        /* Crediting the Intercompany Payable Account  */
        var custPayable = pCustLines.addNewLine();
        custPayable.setAccountId(Number(sInterPayable));
        if (oLineData.CLASS) {
            custPayable.setClassId(Number(oLineData.CLASS));
        }
        if (oLineData.DEPARTMENT) {
            custPayable.setDepartmentId(Number(oLineData.DEPARTMENT));
        }
        if (oLineData.LOCATION) {
            custPayable.setLocationId(Number(oLineData.LOCATION));
        }
        custPayable.setCreditAmount(Number(oLineData.CUSTOM_COST) * Number(oLineData.QUANTITY));
    });
}

/**
 * Return fulfilled Item lines with classification data.
 *
 * @param {Object} pFulfillmentRec
 *
 * @return {Object[]}
 */
function getFulfilledItems(pFulfillmentRec) {

    var oFulfilledItems = [];
    var subLines = pFulfillmentRec.getLineItemCount('item');

    for (var nLine = 1; nLine <= subLines; nLine++) {

        var lineFulfilled = pFulfillmentRec.getLineItemValue('item', 'itemreceive', nLine);

        if (lineFulfilled === 'T') {

            var oLineData = {
                ITEM: pFulfillmentRec.getLineItemValue('item', 'item', nLine),
                QUANTITY: pFulfillmentRec.getLineItemValue('item', 'quantity', nLine),
                DEPARTMENT: pFulfillmentRec.getLineItemValue('item', 'department', nLine),
                CLASS: pFulfillmentRec.getLineItemValue('item', 'class', nLine),
                LOCATION: pFulfillmentRec.getLineItemValue('item', 'location', nLine),
                CUSTOM_COST: pFulfillmentRec.getLineItemValue('item', 'custcol_360_custom_cost', nLine)
            }

            oFulfilledItems.push(oLineData)
        }
    }

    return oFulfilledItems;
}

/**
 * Searches and add the corresponding COGS account to each line item.
 *
 * @param {Object[]} pLinesData
 *
 * @return {Object[]}
 * */
function addAccountToLineItems(pLinesData) {

    /* Getting unique line Items to use as a search filter */
    var aItems = [];
    pLinesData.forEach(function (oLineData) {
        if (aItems.indexOf(oLineData.ITEM) === -1) {

            aItems.push(oLineData.ITEM);
        }
    });

    var filters = [];
    filters.push(
        new nlobjSearchFilter('isinactive', null, 'is', 'F')
    );
    filters.push(
        new nlobjSearchFilter('internalid', null, 'anyof', aItems)
    );

    var columns = [];
    columns.push(
        new nlobjSearchColumn('internalid')
    );
    columns.push(
        new nlobjSearchColumn('expenseaccount')
    );

    var oSearchResults = nlapiSearchRecord('item', null, filters, columns) || [];

    var oItemsData = {};
    oSearchResults.forEach(function (oResult) {

        var sItemKey = oResult.getValue('internalid');
        oItemsData[sItemKey] = oResult.getValue('expenseaccount');
    });

    pLinesData.forEach(function (oLineData) {

        oLineData.COGS_ACCOUNT = oItemsData[oLineData.ITEM];
    });

    return pLinesData;
}
