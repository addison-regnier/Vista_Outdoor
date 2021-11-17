/**
 * This UserEvent script populates the Custom Cost line/column field for fulfilled lines considering the
 * Intercompany Markup and the Vista Owned Customer checkbox.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */
define(['N/runtime', 'N/search'],

    (runtime, search) => {

        /**
         * Loop through the item sublist and get needed data from fulfilled lines.
         *
         * @param {Object} pRec
         * */
        const getSublistData = (pRec) => {

            const oSublistFields = {
                FULFILLED: 'itemreceive',
                ORDER_LINE: 'orderline',
                ITEM: 'item',
                LOCATION: 'location'
            };

            const oLinesData = [];
            const nLines = pRec.getLineCount({
                sublistId: 'item'
            });

            for (let nLine = 0; nLine < nLines; nLine++) {

                const oLineData = {};
                for (const sField in oSublistFields) {

                    oLineData[sField] = pRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: oSublistFields[sField],
                        line: nLine
                    });
                }

                if (oLineData.FULFILLED) {

                    oLinesData.push(oLineData);
                }
            }

            return oLinesData;
        }

        /**
         * Searches and get needed items data considering if the customer is a Vista Owned customer or not.
         *
         * @param {Object[]} pLinesData
         * @param {string} pCurrency
         * @param {number} pInterMarkup
         * @param {number} pInterDiscount
         * @param {Boolean} pIsVistaOwned
         *
         * @return {Object[]}
         * */
        const getItemsData = (pLinesData, pCurrency, pInterMarkup, pInterDiscount, pIsVistaOwned) => {

            /* Creating an Array of Unique Items IDs */
            const aItems = [...new Set(pLinesData.map(oLineData => oLineData.ITEM))];

            const oColumnsMap = {
                ITEM: {name: 'internalid'},
                LOCATION: {name: 'inventorylocation'},
            };

            const filters = [];
            filters.push(
                search.createFilter({
                    name: 'internalid',
                    operator: search.Operator.ANYOF,
                    values: aItems
                })
            );

            // Adding Columns conditionally.
            if (pIsVistaOwned) {

                oColumnsMap.LOCATION_COST = {name: 'locationcost'};

            } else {

                oColumnsMap.BASE_PRICE = {name: 'unitprice', join: 'pricing'};

                filters.push(
                    search.createFilter({
                        name: 'pricelevel',
                        join: 'pricing',
                        operator: search.Operator.ANYOF,
                        values: '1' // Base Price
                    })
                );
                filters.push(
                    search.createFilter({
                        name: 'currency',
                        join: 'pricing',
                        operator: search.Operator.ANYOF,
                        values: pCurrency
                    })
                );
            }

            const columns = [...Object.keys(oColumnsMap).map(sColumn => search.createColumn(oColumnsMap[sColumn]))];

            const oSearch = search.create({
                type: search.Type.ITEM,
                filters,
                columns
            });

            const oItemsData = {};
            oSearch.run().each((oResult) => {

                const oData = Object.keys(oColumnsMap).reduce((oAccumulator, sColumn) => {

                    oAccumulator[sColumn] = oResult.getValue(oColumnsMap[sColumn]);

                    return oAccumulator;
                }, {});

                /* Grouping Item and Location */
                (oItemsData[oData.ITEM] || (oItemsData[oData.ITEM] = {}))[oData.LOCATION] = oData;

                return true;
            });

            /* Calculating the Item/Line Custom Cost conditionally */
            pLinesData.forEach(function (oLineData) {

                if (pIsVistaOwned) {

                    const nItemLocationCost = (oItemsData.hasOwnProperty(oLineData.ITEM) &&
                        oItemsData[oLineData.ITEM].hasOwnProperty(oLineData.LOCATION)) ?
                        Number(oItemsData[oLineData.ITEM][oLineData.LOCATION].LOCATION_COST) : 0;

                    oLineData.CUSTOM_COST = (nItemLocationCost === 0) ? 0 :
                        nItemLocationCost + (nItemLocationCost * pInterMarkup / 100);

                } else {

                    const nItemBasePrice = (oItemsData.hasOwnProperty(oLineData.ITEM) &&
                        oItemsData[oLineData.ITEM].hasOwnProperty(oLineData.LOCATION)) ?
                        Number(oItemsData[oLineData.ITEM][oLineData.LOCATION].BASE_PRICE) : 0;

                    if (nItemBasePrice === 0) {

                        oLineData.CUSTOM_COST = 0;

                    } else if (pInterDiscount === 0) {

                        oLineData.CUSTOM_COST = nItemBasePrice;

                    } else {

                        oLineData.CUSTOM_COST = nItemBasePrice - (nItemBasePrice * pInterDiscount / 100);
                    }
                }
            });

            return pLinesData;
        }

        /**
         * Loop through the item sublist and updates/set the Custom Cost column value in the given fulfilled lines.
         *
         * @param {Object} pRec
         * @param {Object[]} pFulfilledLinesData
         * */
        const updateFulfilledLines = (pRec, pFulfilledLinesData) => {

            pFulfilledLinesData.forEach(function (oLineData) {

                const nFoundLine = pRec.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'orderline',
                    value: oLineData.ORDER_LINE
                });

                if (nFoundLine !== -1) {

                    pRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_360_custom_cost',
                        line: nFoundLine,
                        value: oLineData.CUSTOM_COST
                    });
                }
            });
        }

        /**
         * Defines the function definition that is executed before record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeSubmit = (scriptContext) => {

            if (scriptContext.type !== scriptContext.UserEventType.CREATE) {

                return;
            }

            const oRec = scriptContext.newRecord;

            const sCustomerId = oRec.getValue({
                fieldId: 'entity'
            });

            if (!sCustomerId) {

                return;
            }

            const sVistaOwnedField = 'custentity_360_vista_owned_company';
            const sInterMarkupField = 'custentity_360_int_company_markup';

            let nInterDiscount = runtime.getCurrentUser().getPreference({name: 'custscript_360_int_company_discount'});
            nInterDiscount = (isNaN(parseFloat(nInterDiscount))) ? 0 : parseFloat(nInterDiscount);

            const oCustomerLookUp = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: sCustomerId,
                columns: [sVistaOwnedField, sInterMarkupField]
            });

            const nInterMarkup = (isNaN(parseFloat(oCustomerLookUp[sInterMarkupField]))) ? 0 : parseFloat(oCustomerLookUp[sInterMarkupField]);
            const isVistaOwned = oCustomerLookUp[sVistaOwnedField];
            const sCustomerCurrency = oRec.getValue({
                fieldId: 'entitycurrency'
            });

            let oFulfilledLinesData = getSublistData(oRec);

            oFulfilledLinesData = getItemsData(oFulfilledLinesData, sCustomerCurrency, nInterMarkup, nInterDiscount, isVistaOwned);

            log.audit({
                title: 'Updating Fulfilled Lines with Data',
                details: oFulfilledLinesData
            });

            updateFulfilledLines(oRec, oFulfilledLinesData);
        }

        return {beforeSubmit}
    });
