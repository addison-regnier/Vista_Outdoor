/**
 * This ClientScript:
 * - Presents a dialog to the user with the SKU Restrictions to dismiss or remove.
 * - Remove lines with Sku Restrictions Type = "Sale Not Permitted in Jurisdiction".
 * - Updates global variable when the validation passed.
 *
 * @NApiVersion 2.0
 * @NScriptType ClientScript
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */

define(['N/currentRecord', 'N/https', 'N/ui/dialog', 'N/util', './360_MOD_vista_rules'],
    function (currentRecord, https, dialog, util, skumod) {

    const VALIDATIONS = {
        JURISDICTION: false,
        MAP_ITEMS: false
    };

    var CUSTOMER_RESTRICTIONS = {};

    /**
     * Adds the body data to each sublist data/object.
     *
     * @param {Object[]} pSublistData
     * @param {Object} pBodyData
     *
     * @return {Object[]}
     * */
    function addBodyData(pSublistData, pBodyData) {

        pSublistData.forEach(function (oSubData) {

            for (var sField in pBodyData) {

                oSubData[sField] = pBodyData[sField];
            }
        });

        return pSublistData;
    }

    /**
     * Process a given Sku Restrictions (Array of Objects) following the Jurisdiction Restriction logic.
     *
     * @param {Object} pRec
     * @param {Object[]} pSkuRestrictions
     * */
    function processJurisdictionRestrictions(pRec, pSkuRestrictions) {

        if (pSkuRestrictions.length === 0) {

            VALIDATIONS.JURISDICTION = true;
            return;
        }

        /* Grouping by Override or not and filtering by Type */
        var oRestrictions = {
            OVERRIDE: [],
            NOT_OVERRIDE: []
        };
        pSkuRestrictions.forEach(function (oRestriction) {

            /* Filtering by Type = 1 // Sales Not Permitted in Jurisdiction */
            if (oRestriction.TYPE === '1') {

                if (oRestriction.OVERRIDE) {

                    oRestrictions.OVERRIDE.push(oRestriction);

                } else {

                    oRestrictions.NOT_OVERRIDE.push(oRestriction);
                }
            }
        });

        if (oRestrictions.OVERRIDE.length === 0 && oRestrictions.NOT_OVERRIDE.length === 0) {

            VALIDATIONS.JURISDICTION = true;

            return;
        }

        var sHTML = '';
        if (oRestrictions.NOT_OVERRIDE.length > 0) {

            sHTML = '<p>This order cannot be saved due to Jurisdiction Restrictions on the following items:</p>' +
                '<html><body><ul style="list-style-type: circle;">';

            oRestrictions.NOT_OVERRIDE.forEach(function (oRestriction) {

                sHTML += '<li>' + oRestriction.ITEM_NAME +'</li>';
            });

            sHTML += '<br><p></p></body></html>';

            dialog.create({
                title: 'SKU Restrictions',
                message: sHTML,
                buttons: [
                    {label: 'Clear Prohibited Items', value: true},
                    {label: 'Cancel', value: false}
                ]
            }).then(function (result) {

                if (result) {

                    removeJurisdictionLines(pRec, oRestrictions.NOT_OVERRIDE);
                    VALIDATIONS.JURISDICTION = true;
                }
            });
        }

        if (oRestrictions.OVERRIDE.length > 0) {

            sHTML = '<p>This order can be saved, but will require additional approval due to Jurisdiction Restrictions on the following items:</p>' +
                '<html><body><ul style="list-style-type: circle;">';

            oRestrictions.OVERRIDE.forEach(function (oRestriction) {

                sHTML += '<li>' + oRestriction.ITEM_NAME +'</li>';
            });

            sHTML += '<br><p></p></body></html>';

            dialog.create({
                title: 'SKU Restrictions',
                message: sHTML,
                buttons: [
                    {label: 'Clear Prohibited Items', value: true},
                    {label: 'Cancel', value: false}
                ]
            }).then(function (result) {

                if (result) {

                    removeJurisdictionLines(pRec, oRestrictions.OVERRIDE);
                    VALIDATIONS.JURISDICTION = true;

                } else {

                    if (oRestrictions.NOT_OVERRIDE.length === 0) {

                        VALIDATIONS.JURISDICTION = true;
                    }
                }
            });
        }

        /**
         * Remove Lines from record/transaction
         *
         * @param {Object} pRec
         * @param {Object} pRestrictions
         * */
        function removeJurisdictionLines(pRec, pRestrictions) {

            /* Creating Restrictions Map */
            var oRestrictionsMap = {};
            pRestrictions.forEach(function (oRestriction) {

                if (!oRestrictionsMap.hasOwnProperty(oRestriction.ITEM)) {

                    oRestrictionsMap[oRestriction.ITEM] = oRestriction;
                }
            });

            /* Removing Lines */
            var nLines = pRec.getLineCount({
                sublistId: 'item'
            });

            var aLinesToRemove = [];
            for (var nLine = 0; nLine < nLines; nLine++) {

                var lineItem = pRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: nLine
                });

                if (oRestrictionsMap.hasOwnProperty(lineItem)) {

                    aLinesToRemove.push(nLine);
                }
            }

            /* Ordering Lines to remove */
            aLinesToRemove.sort(function (a, b) {
                return b - a;
            });

            /* Removing Lines */
            aLinesToRemove.forEach(function (nLine) {

                pRec.removeLine({
                    sublistId: 'item',
                    line: nLine
                });
            });
        }
    }

    /**
     * Request Items Data through the helper Suitelet and updates the record data.
     *
     * @param {Object[]} pRecordData
     *
     * @return {Object[]}
     * */
    function getItemsData(pRecordData) {

        /* Getting Items Data through the Suitelet */
        var slURL = skumod.getSLURL(skumod.SUITELET, true);
        var oSLActions = util.extend({}, skumod.SUITELET_ACTIONS);
        oSLActions.GET_ITEM_DATA = true;

        var oData = {
            ACTIONS: oSLActions,
            RECORD_DATA: pRecordData
        };

        var oItemsDataResponse = https.post({
            url: slURL,
            body: JSON.stringify(oData),
            headers: {
                'Content-type': 'application/json'
            }
        });

        return JSON.parse(oItemsDataResponse.body);
    }

    /**
     * Process the MAP Restrictions.
     *
     * @param {Object} pRec
     * @param {Boolean} pApprovedForMapItems
     * @param {Object[]} pRecordData
     * */
    function processMapRestrictions(pRec, pApprovedForMapItems, pRecordData) {

        if (pApprovedForMapItems) {

            VALIDATIONS.MAP_ITEMS = true;
            return;
        }

        /* Filtering Items with MAP Min Price */
        var oMapRestrictions = pRecordData.filter(function (oData) {

            return (oData.MAP);
        });

        if (oMapRestrictions.length === 0 ) {

            VALIDATIONS.MAP_ITEMS = true;
            return;
        }

        var sHTML = '<p>This order cannot be saved, the customer is not approved for MAP items and the following' +
            ' items have a Minimum Advertised Price assigned:</p>' +
            '<html><body><ul style="list-style-type: circle;">';

        oMapRestrictions.forEach(function (oMapItem) {

            sHTML += '<li>' + oMapItem.ITEM_NAME +'</li>';
        });
        sHTML += '<br></body></html>';

        dialog.create({
            title: 'MAP Restrictions',
            message: sHTML,
            buttons: [
                {label: 'Clear Prohibited Items', value: 'clearMap'},
                {label: 'Cancel', value: false}
            ]
        }).then(function (result) {

            if (result === 'clearMap') {

                removeMapLines(pRec, oMapRestrictions);
                VALIDATIONS.MAP_ITEMS = true;
            }
        });

        /**
         * Remove Lines from record/transaction
         *
         * @param {Object} pRec
         * @param {Object[]} pRestrictions
         * */
        function removeMapLines(pRec, pRestrictions) {

            /* Creating Map Restrictions Map using the Item as Key */
            var oRestrictionsMap = {};
            pRestrictions.forEach(function (oMapRestriction) {

                if (!oRestrictionsMap.hasOwnProperty(oMapRestriction.ITEM)) {

                    oRestrictionsMap[oMapRestriction.ITEM] = oMapRestriction;
                }
            });

            /* Removing Lines */
            var nLines = pRec.getLineCount({
                sublistId: 'item'
            });

            var aLinesToRemove = [];
            for (var nLine = 0; nLine < nLines; nLine++) {

                var lineItem = pRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: nLine
                });

                if (oRestrictionsMap.hasOwnProperty(lineItem)) {

                    aLinesToRemove.push(nLine);
                }
            }

            /* Ordering Lines to remove */
            aLinesToRemove.sort(function (a, b) {
                return a-b;
            });

            /* Removing Lines */
            aLinesToRemove.forEach(function (nLine) {

                pRec.removeLine({
                    sublistId: 'item',
                    line: nLine
                });
            });
        }
    }

    /**
     * Perform a request to the helper Suitelet to get the Restrictions for a given Customer.
     * */
    function getCustomerRestrictions(pCustomerId) {

        var slURL = skumod.getSLURL(skumod.SUITELET, true);
        var oSLActions = util.extend({}, skumod.SUITELET_ACTIONS);
        oSLActions.GET_CUST_REST = true;

        var oData = {
            ACTIONS: oSLActions,
            CUSTOMER: pCustomerId
        };

        var oResponse = https.post({
            url: slURL,
            body: JSON.stringify(oData),
            headers: {
                'Content-type': 'application/json'
            }
        });

        return JSON.parse(oResponse.body);
    }

    /**
     * Function to be executed after page is initialized.
     *
     * @param {Object} context - The Context Object
     * @param {Record} context.currentRecord - Current form record
     * @param {string} context.mode - The mode in which the record is being accessed (create, copy, or edit)
     *
     * @since 2015.2
     */
    function pageInit(context) {

        var oRec = context.currentRecord;
        var sCustomer = oRec.getValue({
            fieldId: 'entity'
        });

        /* Getting Customer Restrictions */
        if (sCustomer) {
            console.log(sCustomer);

            CUSTOMER_RESTRICTIONS = getCustomerRestrictions(sCustomer);

        }
    }

    /**
     * Function to be executed after a field is sourced
     *
     * @param {Object} context
     * @param {Record} context.currentRecord - Current form record
     * @param {string} context.sublistId - Sublist name
     * @param {string} context.fieldId - Field name
     * @param {number} context.lineNum - Line number. Will be undefined if not a sublist or matrix field
     * @param {number} context.columnNum - Line number. Will be undefined if not a matrix field
     *
     * @since 2015.2
     */
    function postSourcing(context) {

        var oRec = context.currentRecord;

        /* Getting/Updating the Customer Restrictions if the Customer/Entity changes */
        if (context.fieldId === 'entity' && !context.sublistId) {

            var sCustomer = oRec.getValue({
                fieldId: 'entity'
            });

            CUSTOMER_RESTRICTIONS = getCustomerRestrictions(sCustomer);
        }

        /* Applying the Customer SKU Restrictions logic and Item LifeCycle Restriction Logic */
        if (context.fieldId === 'item' && context.sublistId === 'item') {

            var sLineItem = oRec.getCurrentSublistValue({
                sublistId: context.sublistId,
                fieldId: context.sublistId
            });

            /* Prevent Post Sourcing Loop */
            if (!sLineItem) {

                return;
            }

            var oRestricted = CUSTOMER_RESTRICTIONS.find(function (oRestriction) {

                return sLineItem === oRestriction.ITEM;
            });

            var sHTML = '';
            if (oRestricted) {

                sHTML = '<p>The item: ' + oRestricted.ITEM_NAME + ' cannot be purchased by this customer due' +
                    ' to SKU Restrictions.</p>' +
                    '<html><body><ul style="list-style-type: circle;">';

                sHTML += '<br></body></html>';

                dialog.create({
                    title: 'Customer SKU Restrictions',
                    message: sHTML
                });

                oRec.setCurrentSublistValue({
                    sublistId: context.sublistId,
                    fieldId: context.fieldId,
                    value: ''
                });
            }

            /* Checking Lifecycle Restrictions */
            var sLineLifeCycle = oRec.getCurrentSublistValue({
                sublistId: context.sublistId,
                fieldId: skumod.SALES_ORDER_LINE_FIELDS.LIFECYCLE
            });

            if (skumod.FORBIDDEN_LIFECYCLES.indexOf(sLineLifeCycle) !== -1) {

                sHTML = '<p>The Item you are trying to add is not valid due to the Item Lifecycle Restrictions.</p>' +
                    '<html><body>';
                sHTML += '<br></body></html>';

                dialog.create({
                    title: 'Item Lifecycle Restrictions',
                    message: sHTML
                });

                oRec.setCurrentSublistValue({
                    sublistId: context.sublistId,
                    fieldId: context.fieldId,
                    value: ''
                });
            }
        }
    }

    /**
     * Validation function to be executed when record is saved.
     *
     * @param {Object} context - Context Object
     * @param {Record} context.currentRecord - Current record
     * @returns {boolean} Return true if record is valid
     *
     * @since 2015.2
     */
    function saveRecord(context) {

        if (VALIDATIONS.JURISDICTION && VALIDATIONS.MAP_ITEMS) {

            return true;
        }

        var oRec = context.currentRecord;

        /* Getting Line and Body record data and merging it */
        var oLinesData = skumod.getSublistData(oRec, 'item', skumod.SALES_ORDER_LINE_FIELDS);
        var oBodyData = skumod.getBodyData(oRec, skumod.SALES_ORDER_BODY_FIELDS);

        if (oLinesData.length === 0 || Object.keys(oBodyData).length === 0) {

            return true;
        }
        var oRecordData = addBodyData(oLinesData, oBodyData);

        /* Updating Record Data with Items Data */
        oRecordData = getItemsData(oRecordData);

        /* Getting Restrictions from Suitelet */
        var slURL = skumod.getSLURL(skumod.SUITELET, true);
        var oSLActions = util.extend({}, skumod.SUITELET_ACTIONS);
        oSLActions.GET_REST = true;

        var oData = {
            ACTIONS: oSLActions,
            RECORD_DATA: oRecordData
        };

        https.post.promise({
            url: slURL,
            body: JSON.stringify(oData),
            headers: {
                'Content-type': 'application/json'
            }

        }).then(function (oResponse) {

            var oRestrictions = JSON.parse(oResponse.body);

            /* Filtering Restrictions by COUNTRY, STATE OR ZIP CODE */
            var oValidRestrictions = oRestrictions.RESTRICTIONS_DATA.filter(function (oRestriction) {

                return ((oRestriction.ZIP_CODE && oRestriction.ZIP_CODE == oBodyData.ZIP_CODE) ||

                    (!oRestriction.ZIP_CODE &&
                        (
                            (oRestriction.STATE && oRestriction.STATE == oBodyData.STATE) ||
                            (!oRestriction.STATE && oRestriction.COUNTRY && oRestriction.COUNTRY == oBodyData.COUNTRY)
                        )
                    )
                );
            });

            /* Updating Restrictions with Record Data */
            oValidRestrictions.forEach(function (oRestData) {

                var oData = oRecordData.filter(function (oRecData) {

                    return (oRecData.ITEM === oRestData.ITEM || oRecData.ECCN === oRestData.ECCN);
                });

                if (oData.length > 0) {

                    oRestData.CUSTOMER = (!oRestData.CUSTOMER) ? oData[0].CUSTOMER : oRestData.CUSTOMER;
                    oRestData.ITEM = (!oRestData.ITEM) ? oData[0].ITEM : oRestData.ITEM;
                    oRestData.ITEM_NAME = (!oRestData.ITEM_NAME) ? oData[0].ITEM_NAME : oRestData.ITEM_NAME;
                    oRestData.QUANTITY = oData[0].QUANTITY;
                    oRestData.PO_NUMBER = oData[0].PO_NUMBER;
                    oRestData.ORDER_DATE = oData[0].ORDER_DATE;
                }
            });

            processJurisdictionRestrictions(oRec, oValidRestrictions);
            processMapRestrictions(oRec, oRestrictions.MAP_ITEMS_APPROVED, oRecordData);

            if (VALIDATIONS.JURISDICTION && VALIDATIONS.MAP_ITEMS) {

                var saveButton = window.document.getElementById('btn_multibutton_submitter');
                if (saveButton) {

                    saveButton.click();
                }
            }
        });

        return false;
    }

    return {
        pageInit: pageInit,
        postSourcing: postSourcing,
        saveRecord: saveRecord
    }
});
