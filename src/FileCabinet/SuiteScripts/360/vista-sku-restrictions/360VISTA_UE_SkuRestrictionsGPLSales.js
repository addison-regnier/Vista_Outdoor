/**
 * This UserEvent:
 * - Gets the Customer GPL Config Data and updates lines as needed.
 *
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */
define(['N/search'],

function(search) {

    /**
     * Searches and returns a object with the GPL Config Data for a given Customer.
     *
     * @param {string} pCustomerId
     *
     * @return {Object}
     * */
    function getGPLConfig(pCustomerId) {

        var oColumnsMap = {
            CUSTOMER: {name: 'custrecord_360_customer'},
            GPL: {name: 'custrecord_360_gpl'},
            SALES_MGR: {name: 'custrecord_360_smgr'},
            SALES_REP: {name: 'custrecord_360_agency'},
            SUB_REP: {name: 'custrecord_360_subrepresentative'},
            PRIORITY: {name: 'custrecord_360_priority'}
        };

        var aFilters = [];
        aFilters.push(
            search.createFilter({
                name: 'isinactive',
                operator: search.Operator.IS,
                values: false
            })
        );
        aFilters.push(
            search.createFilter({
                name: 'custrecord_360_customer',
                operator: search.Operator.ANYOF,
                values: pCustomerId
            })
        );

        var aColumns = [];
        for (var sColumn in oColumnsMap) {
            aColumns.push(search.createColumn(oColumnsMap[sColumn]));
        }

        var oSearch = search.create({
            type: 'customrecord_360_gpl_config',
            filters: aFilters,
            columns: aColumns
        });

        var oGPLConfig = {};
        oSearch.run().each(function (oResult) {

            var sGPL = oResult.getValue(oColumnsMap.GPL);

            var oData = {};
            for (var sColumn in oColumnsMap) {
                oData[sColumn] = oResult.getValue(oColumnsMap[sColumn]);
            }

            oGPLConfig[sGPL] = oData;

            return true;
        });

        return oGPLConfig;
    }

    /**
     * Iterates over the items sublist and update/set the GPL Sub Rep from a given GPL Config object/data set.
     *
     * @param {Object} pRec
     * @param {Object} pGPLConfig
     * */
    function updateGPLLines(pRec, pGPLConfig) {

        var nLines = pRec.getLineCount({
            sublistId: 'item'
        });

        for (var nLine = 0; nLine < nLines; nLine++) {

            var sLineGPL = pRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_360_sales_gpl',
                line: nLine
            });

            // GPL - None = '6'
            if (sLineGPL && sLineGPL !== '6') {

                if (pGPLConfig.hasOwnProperty(sLineGPL) && pGPLConfig[sLineGPL].SALES_REP && pGPLConfig[sLineGPL].SUB_REP) {

                    pRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_360_sales_gpl_subrep',
                        line: nLine,
                        value: pGPLConfig[sLineGPL].SUB_REP
                    });
                }
            }
        }
    }

    /**
     * Function definition to be triggered before record is submitted.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - New record
     * @param {Record} context.oldRecord - Old record
     * @param {string} context.type - Trigger type
     * @Since 2015.2
     */
    function beforeSubmit(context) {

        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {

            return;
        }

        var oRec = context.newRecord;
        var sCustomerId = oRec.getValue({
            fieldId: 'entity'
        });

        var oGPLConfig = getGPLConfig(sCustomerId);
        if (!Object.keys(oGPLConfig).length) {

            return;
        }

        updateGPLLines(oRec, oGPLConfig);
    }

    return {
        beforeSubmit: beforeSubmit
    };
});
