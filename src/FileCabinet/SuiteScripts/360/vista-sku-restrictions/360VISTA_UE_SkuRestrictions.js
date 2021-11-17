/**
 * This UserEvent:
 * - Get Sales Order Lines Data and search for matching SKU restrictions.
 * - Break those restrictions(if any) into two groups.
 * - Takes/performs actions accordingly.
 *
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */
define(['N/https', 'N/record', 'N/search', 'N/url', 'N/util', './360_MOD_vista_rules'],

function(https, record, search, url, util, skumod) {

    const STATUS_PENDING_APPROVAL = 'A';
    const STATUS_PENDING_FULFILLMENT = 'B';

    const RESTRICTIONS_TYPES = {
        SALE_NOT_PERMITTED: {
            ID: '1',
            REASON: 'Sale not Permitted in Jurisdiction'
        },
        CANT_PURCHASE_ITEM: {
            ID: '2',
            REASON: 'Customer Cannot Purchase this Item',
        },
        EXPORT_CERT_REQUIRED: {
            ID: '3',
            REASON: 'No valid certificate for this item and quantity'
        }
    };

    const GPL_NONE = '6';

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
     * Removes lines with HARD restrictions if any and throw an error if there no remaining lines.
     *
     * @param {Object} pRec
     * @param {Object} pData
     * @param {Boolean} pNotDuplicate
     * @param {Object} pValidShippingAddressData
     * */
    function processRestrictions(pRec, pData, pNotDuplicate, pValidShippingAddressData) {

        /* Grouping Restrictions by HARD and SOFT */
        var oRestrictions = {
            HARD: [],
            SOFT: [],
            ADJUST: [],
            PRICE: [],
            CERT: [],
            GPL: []
        };

        pData.forEach(function (oRestriction) {

            if ((oRestriction.hasOwnProperty('OVERRIDE') && oRestriction.OVERRIDE) ||
                (oRestriction.hasOwnProperty('MAX_ALLOWED_QTY') && oRestriction.MAX_ALLOWED_QTY > 0) ||
                oRestriction.hasOwnProperty('PRICE') && oRestriction.PRICE) {

                if (oRestriction.hasOwnProperty('OVERRIDE') && oRestriction.OVERRIDE) {

                    oRestrictions.SOFT.push(oRestriction);
                }

                if (oRestriction.hasOwnProperty('MAX_ALLOWED_QTY') && oRestriction.MAX_ALLOWED_QTY > 0) {

                    oRestrictions.ADJUST.push(oRestriction);
                }

                if (oRestriction.hasOwnProperty('PRICE')) {

                    oRestrictions.PRICE.push(oRestriction);
                }

            } else if(oRestriction.TYPE === 'CERT') {

                oRestrictions.CERT.push(oRestriction);

            } else if(oRestriction.TYPE === 'GPL') {

                oRestrictions.GPL.push(oRestriction);

            } else {

                oRestrictions.HARD.push(oRestriction)
            }
        });

        /* Getting the SOFT Restrictions into the Invalid Order Reason Field */
        var sInvalidOrderReason = '';
        oRestrictions.SOFT.forEach(function (oRestriction) {

            sInvalidOrderReason += oRestriction.ITEM_NAME + ' - ' + oRestriction.REASON + '\n';
        });

        /* Getting Adjusted Lines into the Invalid Order Reason Field*/
        oRestrictions.ADJUST.forEach(function (oRestriction) {

            sInvalidOrderReason += oRestriction.ITEM_NAME + ' - ' + oRestriction.REASON +
                ', Quantity: ' + oRestriction.QUANTITY + ' reduced to: ' + oRestriction.MAX_ALLOWED_QTY + '\n';
        });

        /* Getting PRICE Restrictions into the Invalid Order Reason Field*/
        oRestrictions.PRICE.forEach(function (oRestriction) {

            sInvalidOrderReason += oRestriction.ITEM_NAME + ' - ' + oRestriction.REASON + '\n';
        });

        /* Getting CERT Restrictions into the Invalid Order Reason Field*/
        oRestrictions.CERT.forEach(function (oRestriction) {

            sInvalidOrderReason += oRestriction.ITEM_NAME + ' - ' + oRestriction.REASON + '\n';
        });

        /* Getting GPL Restrictions into the Invalid Order Reason Field*/
        oRestrictions.GPL.forEach(function (oRestriction) {

            sInvalidOrderReason += oRestriction.ITEM_NAME + ' - ' + oRestriction.REASON + '\n';
        });

        /* Updating Invalid Order Reason for Duplicate PO */
        if (!pNotDuplicate) {

            sInvalidOrderReason += 'Possible Duplicate PO - Confirmation Required' + '\n';
        }

        /* Updating Invalid Order Reason for Invalid Shipping Address */
        if (!pValidShippingAddressData.IS_VALID) {

            sInvalidOrderReason += pValidShippingAddressData.REASON;
        }

        pRec.setValue({
            fieldId: 'custbody_360_invalid_order_reason',
            value: sInvalidOrderReason
        });

        /* Removing Lines with HARD and Map Restrictions */
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

            var toRemove = oRestrictions.HARD.filter(function (oHard) {

                return (lineItem === oHard.ITEM && aLinesToRemove.indexOf(nLine) === -1);
            });
            if (toRemove.length) {

                aLinesToRemove.push(nLine);
            }

            /* Check if this line needs to be adjusted to the Max Allowed Quantity */
            var toAdjust = oRestrictions.ADJUST.filter(function (oSoft) {

                return (lineItem === oSoft.ITEM && oSoft.hasOwnProperty('MAX_ALLOWED_QTY'));
            });
            if (toAdjust.length) {

                pRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    value: toAdjust[0].MAX_ALLOWED_QTY,
                    line: nLine
                });
            }

            /* Updating PRICE Restrictions Lines with the System Price */
            var toUpdate = oRestrictions.PRICE.filter(function (oPrice) {

                return (nLine === oPrice.LINE_IDX && oPrice.hasOwnProperty('PRICE'));
            });
            if (toUpdate.length) {

                pRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_360_system_price',
                    value: Number(toUpdate[0].PRICE),
                    line: nLine
                });
            }
        }

        if (nLines === aLinesToRemove.length) {

            throw 'Order Invalid due to Sku Restrictions';
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

        /* Setting the Order to Pending Approval if there is Soft, Price, Duplicate PO, or Cert Restrictions */
        if (oRestrictions.SOFT.length || oRestrictions.PRICE.length ||
            oRestrictions.CERT.length || oRestrictions.GPL.length || !pNotDuplicate || !pValidShippingAddressData.IS_VALID) {

            pRec.setValue({
                fieldId: 'orderstatus',
                value: STATUS_PENDING_APPROVAL
            });
        }
    }

    /**
     * Searches for Export Certificates and validates a given array of Objects(Restrictions) against those certificates.
     *
     * @param {Object[]} pExportCertRestrictions
     *
     * @return {Object[]}
     * */
    function validateExportCertRestrictions(pExportCertRestrictions) {

        var oExportCertificates = skumod.getExportCertificates(pExportCertRestrictions);

        /* If there is no Export Certificates for these items/eccns all restrictions are valid */
        if (oExportCertificates.length === 0) {

            /* Updating the Restriction Type */
            pExportCertRestrictions.forEach(function (oRestriction) {
                oRestriction.TYPE = 'CERT';
            });

            return pExportCertRestrictions;
        }

        var oValidatedRestrictions = [];
        pExportCertRestrictions.forEach(function (oRestriction) {

            /* Filtering the Certs related to a given Restriction rule */
            var oRestrictionCertsData = oExportCertificates.filter(function (oData) {

                return oRestriction.ITEM === oData.ITEM || (oRestriction.ECCN && oRestriction.ECCN === oData.ECCN);
            });

            /* Calculating each Restriction Value and Quantity */
            var nRestrictionValue = Number(oRestriction.RATE) * Number(oRestriction.QUANTITY);
            var nRestrictionQty = Number(oRestriction.QUANTITY);

            var nCertsTotalValue = 0;
            var nCertsMaxQuantity = 0;

            /* Determine if we don't have enough Cert Qty or Value for a given Restriction */
            if (oRestrictionCertsData.length) {

                oRestrictionCertsData.forEach(function (oCert) {

                    nCertsTotalValue += Number(oCert.MAX_VALUE);
                    nCertsMaxQuantity += Number(oCert.MAX_QTY);
                });

                if (nCertsTotalValue < nRestrictionValue || nCertsMaxQuantity < nRestrictionQty) {

                    oRestriction.REASON = 'No valid certificate for this item and quantity';
                    oRestriction.TYPE = 'CERT';
                    oValidatedRestrictions.push(oRestriction);
                }

            } else {

                oRestriction.REASON = 'No valid certificate for this item and quantity';
                oRestriction.TYPE = 'CERT';
                oValidatedRestrictions.push(oRestriction);
            }
        });

        return oValidatedRestrictions;
    }

    /**
     * Loops through a given sublist in a given record and return true if there is any line with a System Price
     * value(custom column/line field) or false otherwise.
     *
     * @param {Object} pRec
     * @param {string} pSublistId
     *
     * @return {Boolean}
     * */
    function hasSystemPrice(pRec, pSublistId) {

        var nLines = pRec.getLineCount({
            sublistId: pSublistId
        });

        var sLineSystemPrice;
        for (var nLine = 0; nLine < nLines; nLine++) {

            sLineSystemPrice = pRec.getSublistValue({
                sublistId: pSublistId,
                fieldId: 'custcol_360_system_price',
                line: nLine
            });

            if (Number(sLineSystemPrice)) {

                break;
            }
        }

        return !!(Number(sLineSystemPrice));
    }

    /**
     * Get the given record Shipping Address data and returns an object.
     *
     * @param {Object} pRec
     *
     * @return {Object}
     * */
    function getShippingAddressData(pRec) {

        var oAddressFields = {
            ADDRESS1: 'addr1',
            ADDRESS2: 'addr2',
            CITY: 'city',
            STATE: 'state',
            ZIP: 'zip',
            COUNTRY: 'country'
        };

        var oAddressRec = pRec.getSubrecord({
            fieldId: 'shippingaddress'
        });

        var oAddressData = {};
        for (var sField in oAddressFields) {

            oAddressData[sField] = oAddressRec.getValue({
                fieldId: oAddressFields[sField]
            });
        }

        return oAddressData;
    }

    /**
     * This function adds a button and logic to handle its click event.
     *
     * @param {Object} context - Context Object
     * @param {Record} context.newRecord - New record
     * @param {string} context.type - Trigger type
     * @param {Form} context.form - Current form
     */
    function addButtonToForm(context) {

        var oSL = util.extend({}, skumod.SUITELET);
        oSL.params = {
            soId: context.newRecord.id,
            updatePrice: true
        };
        oSL.returnExternalUrl = false;

        var href = url.resolveScript(oSL);

        context.form.addButton({
            id: 'custpage_accept_price',
            label: 'Accept System Price',
            functionName: '(document.getElementById("custpage_accept_price").onclick = null); (window.location="' + href + '")'
        });
    }

    /**
     * Validates the Sales Order Shipping Address and return true or false.
     *
     * @param {Object} pRec
     *
     * @return {Object}
     * */
    function validateShippingAddress(pRec) {

        var oValidationData = {
            IS_VALID: false,
            REASON: ''
        };

        /* Getting the Subsidiary Country for validation exclusion with the Shipping Address Country */
        var sSubsidiary = pRec.getValue({
            fieldId: 'subsidiary'
        });
        var oSubsidiaryLookup = search.lookupFields({
            type: search.Type.SUBSIDIARY,
            id: sSubsidiary,
            columns: ['country']
        });
        var sSubCountry = (oSubsidiaryLookup['country'].length && oSubsidiaryLookup['country'][0].value) ?
            oSubsidiaryLookup['country'][0].value : '';

        var oShippingData = {
            SHIPPING_METHOD: pRec.getValue({fieldId: 'shipmethod'})
        };

        if (oShippingData.SHIPPING_METHOD) {

            oShippingData.SHIPPING_METHOD = search.lookupFields({
                type: search.Type.SHIP_ITEM,
                id: oShippingData.SHIPPING_METHOD,
                columns: ['itemid']
            }).itemid;
        }

        var oShippingAddressData = getShippingAddressData(pRec);
        if (!oShippingAddressData.ADDRESS1 &&
            !oShippingAddressData.CITY &&
            !oShippingAddressData.STATE &&
            !oShippingAddressData.ZIP) {

            oValidationData.IS_VALID = false;
            oValidationData.REASON = 'Address cannot be validated against State/Zip Code combination' + '\n';

            return oValidationData;
        }

        oShippingData = util.extend(oShippingData, oShippingAddressData);

        /* Doing PO BOX Validation */
        if (oShippingData.COUNTRY === 'US') {

            var sAddress1 = oShippingData.ADDRESS1.toUpperCase().replace('.', '');
            var sAddress2 = oShippingData.ADDRESS2.toUpperCase().replace('.', '');

            if (sAddress1.indexOf('PO BOX') !== -1 || sAddress2.indexOf('PO BOX') !== -1) {

                if ((oShippingData.SHIPPING_METHOD.indexOf('FedEx') !== -1 ||
                    oShippingData.SHIPPING_METHOD.indexOf('UPS') !== -1) &&
                    oShippingData.SHIPPING_METHOD.indexOf('Smartpost') === -1) {

                    oValidationData.IS_VALID = false;
                    oValidationData.REASON = 'Cannot ship FedEx or UPS to PO BOX' + '\n';

                    return oValidationData;
                }
            }

            /* Normalize State to Short Code */
            if (oShippingData.STATE) {

                var oStateData = skumod.getStateData(oShippingData.STATE, oShippingData.COUNTRY);

                if (oStateData.hasOwnProperty('shortname')) {

                    oShippingData.STATE = oStateData.shortname;
                }
            }

            var sRequestPayload = skumod.buildRequestPayload(oShippingData);
            var oVertexAddressData = skumod.getAddressDataFromVertex(sRequestPayload);

            if (!Object.keys(oVertexAddressData).length) {

                oValidationData.IS_VALID = false;
                oValidationData.REASON = 'Address cannot be validated against State/Zip Code combination' + '\n';

                return oValidationData;
            }

            /* Cleaning Zip Codes */
            oShippingData.ZIP = (oShippingData.ZIP.indexOf('-') !== -1) ?
                oShippingData.ZIP.split('-')[0] : oShippingData.ZIP;

            oVertexAddressData.ZIP = (oVertexAddressData.ZIP.indexOf('-') !== -1) ?
                oVertexAddressData.ZIP.split('-')[0] : oVertexAddressData.ZIP;

            if (oShippingData.STATE !== oVertexAddressData.STATE || oShippingData.ZIP !== oVertexAddressData.ZIP) {

                oValidationData.IS_VALID = false;
                oValidationData.REASON = 'Invalid Zip Code/State' + '\n';

                return oValidationData;
            }

            oValidationData.IS_VALID = true;
            oValidationData.REASON = '';

            return oValidationData;
        } else {

            if (sSubCountry && sSubCountry === oShippingData.COUNTRY) {

                oValidationData.IS_VALID = true;
                oValidationData.REASON = '';

                return oValidationData;
            }
        }

        var reviewedForSpecialHandling = pRec.getValue({
            fieldId: 'custbody_360_reviewed_special_handling'
        });

        if (reviewedForSpecialHandling) {

            oValidationData.IS_VALID = true;
            oValidationData.REASON = '';

            return oValidationData;

        } else {

            oValidationData.IS_VALID = false;
            oValidationData.REASON = 'Review for Special Handling - '+ oShippingData.COUNTRY + '\n';

            return oValidationData;
        }
    }

    /**
     * Function definition to be triggered before record is loaded.
     *
     * @param {Object} context - Context Object
     * @param {Record} context.newRecord - New record
     * @param {string} context.type - Trigger type
     * @param {Form} context.form - Current form
     * @Since 2015.2
     */
    function beforeLoad(context) {

        if (context.type !== context.UserEventType.VIEW) {

            return;
        }

        var oRec = context.newRecord;

        var sOrderStatus = oRec.getValue({
            fieldId: 'orderstatus'
        });

        if (sOrderStatus && sOrderStatus !== STATUS_PENDING_APPROVAL) {

            return;
        }

       if(hasSystemPrice(oRec, 'item')) {

            addButtonToForm(context);
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

        var oRec = context.newRecord;
        var oOldRec = context.newRecord;

        const CREDIT_HOLD_EVENTS = [context.UserEventType.CREATE, context.UserEventType.EDIT, context.UserEventType.XEDIT];

        /* Do not Re-Evaluate a Sales Order when the Dropped to Box checkbox is checked */
        if (context.type === context.UserEventType.EDIT) {

            var newDroppedToBoss = oRec.getValue({
                fieldId: 'custbody_360_dropped_to_boss'
            });
            var oldDroppedToBoss = oOldRec.getValue({
                fieldId: 'custbody_360_dropped_to_boss'
            });

            if (!newDroppedToBoss && oldDroppedToBoss) {

                return;
            }
        }

        if (CREDIT_HOLD_EVENTS.indexOf(context.type) !== -1) {

            if ( [STATUS_PENDING_FULFILLMENT, STATUS_PENDING_APPROVAL].indexOf(oRec.getValue({fieldId: 'orderstatus'})) > -1 ) {

                var oRemainingCredit = skumod.getRemainingCredit( oRec.getValue({fieldId: 'entity'}) );

                // This order would extend past the available credit?
                if (context.type == context.UserEventType.CREATE &&
                    oRemainingCredit.valid &&
                     Number(oRec.getValue({fieldId: 'total'})) > oRemainingCredit.remainingCredit
                 ) {
                    oRemainingCredit.valid = false;
                }

                // Force a cleanup if there is a user override
                if (oRec.getValue({fieldId: 'custbody_360_fin_appr_crd_lim_override'})) {
                    oRemainingCredit.valid = true;
                }

                // Set or clear the Invalid Order Status field as necessary
                oRec.setValue({
                    fieldId: 'custbody_360_invalid_order_reason',
                    value: oRemainingCredit.valid ? '' : oRemainingCredit.remainingCredit
                });

                oRec.setValue({
                    fieldId: 'orderstatus',
                    value: oRemainingCredit.valid ? STATUS_PENDING_FULFILLMENT : STATUS_PENDING_APPROVAL
                });
            }
        }

        /* Start the Jurisdiction Restriction Logic */
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {

            return;
        }

        /* Validating Shipping Address */
        var oShippingAddressValidationData = validateShippingAddress(oRec);

        var oLinesData = skumod.getSublistData(oRec, 'item', skumod.SALES_ORDER_LINE_FIELDS);
        var oldLinesData = (oRec.id) ? skumod.getSublistData(context.oldRecord, 'item', skumod.SALES_ORDER_LINE_FIELDS) : [];
        var oBodyData = skumod.getBodyData(oRec, skumod.SALES_ORDER_BODY_FIELDS);
        if (oLinesData.length === 0 || Object.keys(oBodyData).length === 0) {

            return;
        }

        var oRecordData = addBodyData(oLinesData, oBodyData);
        var oldRecordData = (oRec.id) ? addBodyData(oldLinesData, oBodyData) : [];
        oRecordData = skumod.getItemsData(oRecordData);

        /* Getting the Missing GPL Sub Rep Violations and Updating the Type and Reason */
        var oSubRepGPLViolations = oRecordData.filter(function (oData) {

            if (oData.GPL && oData.GPL !== GPL_NONE && !oData.GPL_SUB_REP) {

                oData.TYPE = 'GPL';
                oData.REASON = 'Missing Customer GPL Config, Sales Agency or Sales Rep.'
                return true;

            } else {

                return false;
            }
        });

        /* Filtering out lines with Cert Applied On values */
        oRecordData = oRecordData.filter(function (oData) {

            return !oData.CERT_APPLIED_ON;
        });

        if (!oRecordData.length) {

            return;
        }

        var oRestrictions = {
            MAP_ITEMS_APPROVED: skumod.getCustomerMapApproval(oBodyData.CUSTOMER),
            RESTRICTIONS_DATA: skumod.getSkuRestrictions(oRecordData, ''),
            CUSTOMER_RESTRICTIONS_DATA: skumod.getCustomerSkuRestrictions(oBodyData.CUSTOMER),
            AVAILABLE_QUANTITY_RESTRICTIONS_DATA: skumod.getItemsAvailableQuantities(oRecordData, oldRecordData),
            PRICE_VARIANCE_RESTRICTIONS_DATA: skumod.getPricingRestrictions(oRecordData)
        };

        var notDuplicate = !!oBodyData.NOT_DUPLICATE
        /* Checking Duplicate Orders Restriction on CREATE and EDIT */
        if (context.type === context.UserEventType.CREATE) {

            if (!notDuplicate) {

                /* Getting the Address Data and Adding PO Number and Customer */
                var oAddressData = getShippingAddressData(oRec);
                oAddressData.CUSTOMER = oBodyData.CUSTOMER;
                oAddressData.PO_NUMBER = oBodyData.PO_NUMBER;

                notDuplicate = (!oAddressData.PO_NUMBER) ? true : skumod.getExistingOrder('', oAddressData);
            }

        } else if (context.type === context.UserEventType.EDIT) {

            if (!oBodyData.PO_NUMBER) {

                notDuplicate = true;
            }

            /* Getting the Address Data and Adding PO Number and Customer */
            var oAddressData = getShippingAddressData(oRec);
            oAddressData.CUSTOMER = oBodyData.CUSTOMER;
            oAddressData.PO_NUMBER = oBodyData.PO_NUMBER;

            notDuplicate = (!oAddressData.PO_NUMBER) ? true : skumod.getExistingOrder(oRec.id, oAddressData);
        }

        /* Filtering Out Override Restrictions */
        oRestrictions.RESTRICTIONS_DATA = oRestrictions.RESTRICTIONS_DATA.filter(function (oRestriction) {

            if (oRestriction.OVERRIDE) {

                var oFoundItem = oRecordData.filter(function (oData) {

                    return oRestriction.ITEM === oData.ITEM && !oData.JURISDICTION_OVERRIDE;
                });

                return oFoundItem.length;
            }

            return true;
        });

        /* Filtering Restrictions by COUNTRY, STATE OR ZIP CODE */
        var oBaseRestrictions = oRestrictions.RESTRICTIONS_DATA.filter(function (oRestriction) {

            return ((oRestriction.ZIP_CODE && oRestriction.ZIP_CODE == oBodyData.ZIP_CODE) ||

                (!oRestriction.ZIP_CODE &&
                    (
                        (oRestriction.STATE && oRestriction.STATE == oBodyData.STATE) ||
                        (!oRestriction.STATE && oRestriction.COUNTRY && oRestriction.COUNTRY == oBodyData.COUNTRY)
                    )
                )
            );
        });

        /* Updating Restriction Data with the Record Data, setting the reason and splitting Restrictions by Type */
        var oValidRestrictions = [];
        var oJurisdictionRestrictions = [];
        var oExportCertRestrictions = [];
        oBaseRestrictions.forEach(function (oRestData) {

            var oData = oRecordData.filter(function (oRecData) {

                return (oRecData.ITEM === oRestData.ITEM || (oRecData.ECCN && oRecData.ECCN === oRestData.ECCN));
            });

            if (oData.length > 0) {

                oRestData.CUSTOMER = (!oRestData.CUSTOMER) ? oData[0].CUSTOMER : oRestData.CUSTOMER;
                oRestData.ITEM = (!oRestData.ITEM) ? oData[0].ITEM : oRestData.ITEM;
                oRestData.ITEM_NAME = (!oRestData.ITEM_NAME) ? oData[0].ITEM_NAME : oRestData.ITEM_NAME;
                oRestData.RATE = oData[0].RATE;
                oRestData.QUANTITY = oData[0].QUANTITY;
                oRestData.PO_NUMBER = oData[0].PO_NUMBER;
                oRestData.ORDER_DATE = oData[0].ORDER_DATE;

                if (oRestData.TYPE === RESTRICTIONS_TYPES.SALE_NOT_PERMITTED.ID) {

                    oRestData.REASON = RESTRICTIONS_TYPES.SALE_NOT_PERMITTED.REASON;

                    oJurisdictionRestrictions.push(oRestData);

                } else if (oRestData.CUSTOMER === oData[0].CUSTOMER &&
                    oRestData.TYPE === RESTRICTIONS_TYPES.EXPORT_CERT_REQUIRED.ID && oRestData.COUNTRY) {

                    oRestData.REASON = RESTRICTIONS_TYPES.EXPORT_CERT_REQUIRED.REASON;

                    oExportCertRestrictions.push(oRestData);
                }
            }
        });

        /* Adding the GPL Restrictions to the Valid Restrictions */
        oValidRestrictions = oValidRestrictions.concat(oSubRepGPLViolations);

        /* Validating Export Certificate Restrictions */
        oExportCertRestrictions = validateExportCertRestrictions(oExportCertRestrictions);

        oValidRestrictions = oValidRestrictions.concat(oJurisdictionRestrictions, oExportCertRestrictions);



        /* Getting Map Restrictions and adding a reason */
        if (!oRestrictions.MAP_ITEMS_APPROVED) {

            var oMapRestrictions = oRecordData.filter(function (oData) {

                if (oData.MAP) {

                    oData.REASON = 'Customer not approved for MAP Items';
                    oData.TYPE = 'MAP';

                    return true;
                }

                return false;
            });

            oValidRestrictions = oValidRestrictions.concat(oMapRestrictions);
        }

        /* Filtering Customer Restrictions */
        oRestrictions.CUSTOMER_RESTRICTIONS_DATA = oRestrictions.CUSTOMER_RESTRICTIONS_DATA.filter(function (oRestriction) {

            var oFound = oRecordData.filter(function (oRecordItem) {

                return oRestriction.ITEM === oRecordItem.ITEM;
            });

            return oFound.length;
        });

        /* Updating Customer Restrictions with Reason */
        oRestrictions.CUSTOMER_RESTRICTIONS_DATA.forEach(function (oRestriction) {

            oRestriction.REASON = 'Customer Cannot Purchase this Item';
            oRestriction.TYPE = 'CUSTOMER';
        });

        /* Adding the Customer Restrictions to the Valid Restrictions */
        oValidRestrictions = oValidRestrictions.concat(oRestrictions.CUSTOMER_RESTRICTIONS_DATA);

        /* Adding Item Lifecycle Restrictions */
        var oLifecycleRestrictions = oRecordData.filter(function (oData) {

            if (skumod.FORBIDDEN_LIFECYCLES.indexOf(oData.LIFECYCLE) !== -1) {

                oData.REASON = 'Invalid Item Lifecycle';
                oData.TYPE = 'LIFECYCLE';

                return true;
            }

            return false;
        });
        oValidRestrictions = oValidRestrictions.concat(oLifecycleRestrictions);

        /* Filtering Valid Max Allowed Quantities Restrictions */
        oRestrictions.AVAILABLE_QUANTITY_RESTRICTIONS_DATA = oRestrictions.AVAILABLE_QUANTITY_RESTRICTIONS_DATA.filter(function (oRestriction) {

            if (oRestriction.QUANTITY_COMMITTED) {

                return ((oRestriction.MAX_ALLOWED_QTY - oRestriction.QUANTITY_COMMITTED) <= oRestriction.QUANTITY_REQUESTED);

            } else {

                return oRestriction.MAX_ALLOWED_QTY < oRestriction.QUANTITY_REQUESTED;
            }
        });

        /* Adding Reason to Max Allowed Quantity Restrictions */
        oRestrictions.AVAILABLE_QUANTITY_RESTRICTIONS_DATA.forEach(function (oData) {

            oData.REASON = (oData.MAX_ALLOWED_QTY <= 0) ?
                skumod.MAX_ALLOWED_QTY_REASON_MAP[oData.LIFECYCLE].NOT_AVAILABLE :
                skumod.MAX_ALLOWED_QTY_REASON_MAP[oData.LIFECYCLE].INSUFFICIENT;
            oData.TYPE = 'MAX ALLOWED QUANTITY';
        });

        oValidRestrictions = oValidRestrictions.concat(oRestrictions.AVAILABLE_QUANTITY_RESTRICTIONS_DATA);

        /* Adding Reason to Pricing Restrictions */
        oRestrictions.PRICE_VARIANCE_RESTRICTIONS_DATA.forEach(function (oData) {

            oData.REASON = 'Incorrect Price, the System Price is: ' + oData.PRICE;
            oData.TYPE = 'Incorrect Price';
        });
        oValidRestrictions = oValidRestrictions.concat(oRestrictions.PRICE_VARIANCE_RESTRICTIONS_DATA);

        if (!oValidRestrictions.length && notDuplicate && oShippingAddressValidationData.IS_VALID) {

            return;
        }

        if (oValidRestrictions.length) {

            /* Sending Restrictions to the Suitelet to Log */
            var slURL = skumod.getSLURL(skumod.SUITELET, true);
            var oSLActions = util.extend({}, skumod.SUITELET_ACTIONS);
            oSLActions.LOG = true;

            var oData = {
                ACTIONS: oSLActions,
                DATA: oValidRestrictions
            };

            https.post({
                url: slURL,
                body: JSON.stringify(oData),
                headers: {
                    'Content-type': 'application/json'
                }
            });
        }

        processRestrictions(oRec, oValidRestrictions, notDuplicate, oShippingAddressValidationData);
    }

    /**
     * Function definition to be triggered after the record is submitted.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - New record
     * @param {Record} context.oldRecord - Old record
     * @param {string} context.type - Trigger type
     * @Since 2015.2
     */
    function afterSubmit(context) {

        /* Start the Jurisdiction Restriction Logic */
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {

            return;
        }

        var oRec = record.load(context.newRecord);
        var oOldRec = context.oldRecord;

        /* Do not Re-Evaluate a Sales Order when the Dropped to Box checkbox is checked */
        if (context.type === context.UserEventType.EDIT) {

            var newDroppedToBoss = oRec.getValue({
                fieldId: 'custbody_360_dropped_to_boss'
            });
            var oldDroppedToBoss = oOldRec.getValue({
                fieldId: 'custbody_360_dropped_to_boss'
            });

            if (!newDroppedToBoss && oldDroppedToBoss) {

                return;
            }
        }

        /* Not Executing the Certificate Decrement Logic if the Order Status is Pending Approval */
        var sOrderStatus = oRec.getValue({
            fieldId: 'orderstatus'
        });

        if (sOrderStatus && sOrderStatus === STATUS_PENDING_APPROVAL) {

            return;
        }

        var oLinesData = skumod.getSublistData(oRec, 'item', skumod.SALES_ORDER_LINE_FIELDS);
        var oBodyData = skumod.getBodyData(oRec, skumod.SALES_ORDER_BODY_FIELDS);
        if (oLinesData.length === 0 || Object.keys(oBodyData).length === 0) {

            return;
        }

        var oRecordData = addBodyData(oLinesData, oBodyData);
        oRecordData = skumod.getItemsData(oRecordData);

        /* Filtering out lines with Cert Applied On values */
        oRecordData = oRecordData.filter(function (oData) {

            return !oData.CERT_APPLIED_ON;
        });

        if (!oRecordData.length) {

            return;
        }

        var oBaseRestrictions = skumod.getSkuRestrictions(oRecordData, '');

        /* Filtering Out Override Restrictions */
        oBaseRestrictions = oBaseRestrictions.filter(function (oRestriction) {

            if (oRestriction.OVERRIDE) {

                var oFoundItem = oRecordData.filter(function (oData) {

                    return oRestriction.ITEM === oData.ITEM && !oData.JURISDICTION_OVERRIDE;
                });

                return oFoundItem.length;
            }

            return true;
        });

        /* Filtering Restrictions by COUNTRY, STATE OR ZIP CODE */
        oBaseRestrictions = oBaseRestrictions.filter(function (oRestriction) {

            return ((oRestriction.ZIP_CODE && oRestriction.ZIP_CODE == oBodyData.ZIP_CODE) ||

                (!oRestriction.ZIP_CODE &&
                    (
                        (oRestriction.STATE && oRestriction.STATE == oBodyData.STATE) ||
                        (!oRestriction.STATE && oRestriction.COUNTRY && oRestriction.COUNTRY == oBodyData.COUNTRY)
                    )
                )
            );
        });

        /* Updating Restriction Data with the Record Data */
        var oExportCertRestrictions = [];
        oBaseRestrictions.forEach(function (oRestData) {

            var oData = oRecordData.filter(function (oRecData) {

                return (oRecData.ITEM === oRestData.ITEM || (oRecData.ECCN && oRecData.ECCN === oRestData.ECCN));
            });

            if (oData.length > 0) {

                oRestData.CUSTOMER = (!oRestData.CUSTOMER) ? oData[0].CUSTOMER : oRestData.CUSTOMER;
                oRestData.ITEM = (!oRestData.ITEM) ? oData[0].ITEM : oRestData.ITEM;
                oRestData.LINE_KEY = oData[0].LINE_KEY;
                oRestData.RATE = oData[0].RATE;
                oRestData.QUANTITY = oData[0].QUANTITY;
                oRestData.PO_NUMBER = oData[0].PO_NUMBER;
                oRestData.ORDER_DATE = oData[0].ORDER_DATE;

                if (oRestData.CUSTOMER === oData[0].CUSTOMER &&

                    oRestData.TYPE === RESTRICTIONS_TYPES.EXPORT_CERT_REQUIRED.ID && oRestData.COUNTRY) {

                    oExportCertRestrictions.push(oRestData);
                }
            }
        });

        if (!oExportCertRestrictions.length) {

            return;
        }

        /* Decrementing Export Certificates and returning the Updated Lines */
        var oLinesApplied = skumod.decrementCertificates(oExportCertRestrictions);
        skumod.updateRecordCertLines(oRec, oLinesApplied);
    }

    return {
        beforeLoad: beforeLoad,
        beforeSubmit: beforeSubmit,
        afterSubmit: afterSubmit
    };
});
