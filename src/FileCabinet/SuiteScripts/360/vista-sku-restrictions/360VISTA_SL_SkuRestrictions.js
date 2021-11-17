/**
 * This Suitelet:
 * - Lookup/Search for SKU Restrictions.
 * - Logs/creates SKU Restrictions Violations.
 * 
 * @NApiVersion 2.0
 * @NScriptType Suitelet
 *
 * @copyright 2021, 360 Cloud Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */
define(['N/https', 'N/record', './360_MOD_vista_rules'],

function(https, record, skumod) {

    /**
     * Handles POST requests
     *
     * @param {string} pContext
     * */
    function handlePOST(pContext) {

        var oRequestData = JSON.parse(pContext.request.body);
        var oRestrictions;

        if (oRequestData.ACTIONS.GET_ITEM_DATA) {

            var oRecordData = skumod.getItemsData(oRequestData.RECORD_DATA);

            return pContext.response.write({output: JSON.stringify(oRecordData)});
        }

        if (oRequestData.ACTIONS.LOG) {

            skumod.createViolationLogs(oRequestData.DATA);

            return;
        }

        if (oRequestData.ACTIONS.GET_REST) {

            oRestrictions = {
                MAP_ITEMS_APPROVED: skumod.getCustomerMapApproval(oRequestData.RECORD_DATA[0].CUSTOMER),
                RESTRICTIONS_DATA: skumod.getSkuRestrictions(oRequestData.RECORD_DATA, '')
            };

            /* Filtering Out Override Restrictions */
            oRestrictions.RESTRICTIONS_DATA = oRestrictions.RESTRICTIONS_DATA.filter(function (oRestriction) {

                if (oRestriction.OVERRIDE) {

                    var oFoundItem = oRequestData.RECORD_DATA.filter(function (oData) {

                        return oRestriction.ITEM === oData.ITEM && !oData.JURISDICTION_OVERRIDE;
                    });

                    return oFoundItem.length;
                }

                return true;
            });

            return pContext.response.write({output: JSON.stringify(oRestrictions)});
        }

        if (oRequestData.ACTIONS.GET_CUST_REST) {

            oRestrictions = skumod.getCustomerSkuRestrictions(oRequestData.CUSTOMER)

            return pContext.response.write({output: JSON.stringify(oRestrictions)});
        }
    }

    /**
     * Handles GET requests.
     *
     * @param {string} pContext
     * */
    function handleGET(pContext) {

        var sOrderId = pContext.request.parameters.soId || '';
        var updatePrice = pContext.request.parameters.updatePrice === 'true' || false;

        if (!sOrderId || !updatePrice) {

            return;
        }

        skumod.updateOrderLinesPrice(sOrderId);

        pContext.response.sendRedirect({
            type: https.RedirectType.RECORD,
            identifier: record.Type.SALES_ORDER,
            id: sOrderId
        });
    }

    /**
     * Definition of the Suitelet script trigger point.
     *
     * @param {Object} context - Context Object
     * @param {ServerRequest} context.request - Encapsulation of the incoming request
     * @param {ServerResponse} context.response - Encapsulation of the Suitelet response
     * @Since 2015.2
     */
    function onRequest(context) {

        if (context.request.method !== 'POST' && context.request.method !== 'GET') {

            log.error({
                title: 'Unexpected Request Method',
                details: 'Unexpected Request Method: '+context.request.method + ' script is expecting method: "POST"' +
                    ' or "GET".'
            });

            return;
        }

        (context.request.method === 'POST') ? handlePOST(context) : handleGET(context);
    }

    return {
        onRequest: onRequest
    }; 
});