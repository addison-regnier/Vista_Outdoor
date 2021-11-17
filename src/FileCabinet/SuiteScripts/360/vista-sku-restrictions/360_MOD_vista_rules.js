/**
 *  Module to support Vista SKU Rules
 *
 * @NApiVersion 2.0
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Blaine Horrocks <bhorrocks@360cloudsolutions.com>
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */

define(['N/file', 'N/https', 'N/record', 'N/search', 'N/runtime', 'N/query', 'N/url', 'N/xml', '../modules/moment.min'],

function(file, https, record, search, runtime, query, url, xml, moment) {

    const SALES_ORDER_LINE_FIELDS = {
        LINE_KEY: 'lineuniquekey',
        ITEM: 'item',
        RATE: 'rate',
        QUANTITY: 'quantity',
        QUANTITY_COMMITTED: 'quantitycommitted',
        LOCATION: 'location',
        AMOUNT: 'amount',
        LIFECYCLE: 'custcol_360_item_lifecycle',
        JURISDICTION_OVERRIDE: 'custcol_360_jurisdiction_override',
        CERT_APPLIED_ON: 'custcol_360_export_cert_applied_on',
        GPL: 'custcol_360_sales_gpl',
        GPL_SUB_REP: 'custcol_360_sales_gpl_subrep'
    };

    const SALES_ORDER_BODY_FIELDS = {
        ORDER_DATE: 'trandate',
        PO_NUMBER: 'otherrefnum',
        CUSTOMER: 'entity',
        NOT_DUPLICATE: 'custbody_360_not_duplicate_order'
    };

    const SKU_RESTRICTIONS_RECORD = 'customrecord_360_sku_rest';
    const SKU_VIOLATION_LOG_RECORD = 'customrecord_360_sku_rest_viola';
    const EXPORT_CERT_RECORD = 'customrecord_360_export_cert';

    const EXPORT_CERT_STATUS = {
        ACTIVE: '1',
        TERMINATED: '2'
    };

    const SKU_REST_REC_MAP = {
        TYPE: 'custrecord_360_sku_rest_type',
        CUSTOMER: 'custrecord_360_sku_rest_customer',
        ITEM: 'custrecord_360_sku_rest_item',
        ITEM_NAME: 'custrecord_360_sku_rest_item',
        ECCN: 'custrecord_360_sku_rest_eccn',
        OVERRIDE: 'custrecord_360_sku_rest_aoverride',
        STATE: 'custrecord_360_sku_rest_state',
        COUNTRY: 'custrecord_360_sku_rest_country',
        ZIP_CODE: 'custrecord_360_sku_rest_zip'
    };

    const EXPORT_CERT_REC_MAP = {
        CUSTOMER: 'custrecord_360_export_cert_cust',
        ITEM: 'custrecord_360_export_cert_item',
        ITEM_NAME: 'custrecord_360_export_cert_item',
        ECCN: 'custrecord_360_export_cert_eccn',
        EXP_DATE: 'custrecord_360_export_cert_exp_date',
        MAX_VALUE: 'custrecord_360_export_cert_max_dollar',
        MAX_QTY: 'custrecord_360_export_cert_max_qty',
        STATUS: 'custrecord_360_export_cert_status'
    };

    const SKU_VIOLATION_LOG_REC_MAP = {
        CUSTOMER: 'custrecord_360_sku_rest_viola_cust',
        ITEM: 'custrecord_360_sku_rest_viola_sku',
        QUANTITY: 'custrecord_360_sku_rest_viola_qty',
        PO_NUMBER: 'custrecord_360_sku_rest_viola_ponum',
        ORDER_DATE: 'custrecord_360_sku_rest_viola_odate',
        REASON: 'custrecord_360_sku_rest_viola_reason'
    };

    const SUITELET = {
        scriptId: 'customscript_360_sl_sku_rest_restrict',
        deploymentId: 'customdeploy_360_sl_sku_rest_restrict'
    };

    const SUITELET_ACTIONS = {
        GET_ITEM_DATA: false,
        LOG: false,
        GET_REST: false,
        GET_CUST_REST: false
    };

    const APPROVED_FOR_MAP_ITEMS = 'custentity_360_approved_for_map';

    const FORBIDDEN_LIFECYCLES = [
        '1', // Item is Inactive
        '2' // Item is In Development
    ];

    const MAX_ALLOWED_QUANTITY_LIFECYCLES = [
        '3', // Discontinued
        '4' // Phase Out
    ];

    const MAX_ALLOWED_QTY_REASON_MAP = {
        '3': {
            NOT_AVAILABLE: 'No Stock available for Discontinued Item',
            INSUFFICIENT: 'Insufficient quantity for Discontinued Item'
        },
        '4': {
            NOT_AVAILABLE: 'No Stock available for Phase Out Item',
            INSUFFICIENT: 'Insufficient quantity for Phase Out Item'
        }
    }

    /**
     * Searches for Export Certificates, decrement matching certificates as needed, updates them and return the
     * lines data.
     *
     * @param {Object[]} pExportCertRestrictions
     *
     * @return {Object[]}
     * */
    function decrementCertificates(pExportCertRestrictions) {

        var oExportCertificates = getExportCertificates(pExportCertRestrictions);
        if (oExportCertificates.length === 0) {

            return pExportCertRestrictions;
        }

        pExportCertRestrictions.forEach(function (oLineData) {

            /* Getting Each Restriction Qty and Value */
            var nLineQty = Number(oLineData.QUANTITY);
            var nLineValue = nLineQty * Number(oLineData.RATE);

            var nCertsMaxQtyTotal = 0;
            var nCertsMaxValueTotal = 0;

            /* Determine if the Certs Total Value or Qty is greater than the Line Qty or Value */
            oExportCertificates.forEach(function (oCertificate) {

                if (oLineData.ITEM === oCertificate.ITEM || (oLineData.ECCN && oLineData.ECCN === oCertificate.ECCN)) {

                    nCertsMaxQtyTotal += Number(oCertificate.MAX_QTY);
                    nCertsMaxValueTotal += Number(oCertificate.MAX_VALUE);
                }
            });

            if (!(nLineQty > nCertsMaxQtyTotal || nLineValue > nCertsMaxValueTotal)) {

                var certificateApplied = false;
                oExportCertificates.forEach(function (oCertificate) {

                    /* Decrementing matching Certificates */
                    if (oLineData.ITEM === oCertificate.ITEM || (oLineData.ECCN && oLineData.ECCN === oCertificate.ECCN)) {

                        /* Getting the Certificate Qty and Value but respecting it if empty */
                        var nCertMaxQty = (oCertificate.MAX_QTY) ? Number(oCertificate.MAX_QTY) : '';
                        var nCertMaxValue = (oCertificate.MAX_VALUE) ? Number(oCertificate.MAX_VALUE) : '';

                        /* If the Certificate has Qty and Value we need to decrement it evenly */
                        if (nCertMaxQty && nCertMaxValue) {

                            /* Decrementing Certificate Qty and Value until one of the field reaches zero or the
                             Restriction Qty and Value reaches zero */
                            while ((nCertMaxQty && nCertMaxValue) && (nLineQty || nLineValue)) {

                                /* Creating and Updating a Decrement Value */
                                var nCertDecrementBy = (nLineQty !== 0) ? nLineValue / nLineQty : nLineValue;
                                nCertDecrementBy = (nCertDecrementBy && nCertDecrementBy <= nCertMaxValue) ? nCertDecrementBy : nCertMaxValue;

                                /* Updating the Cert Qty and Value if needed */
                                nCertMaxQty = (nLineQty) ? nCertMaxQty -1 : nCertMaxQty;
                                nCertMaxValue -= nCertDecrementBy;

                                /* Updating the Restriction/Line Qty and Value if needed */
                                nLineQty = (nLineQty) ? nLineQty - 1 : nLineQty;
                                nLineValue = (nLineValue) ? nLineValue - nCertDecrementBy : nLineValue;
                            }

                            /* Updating the Certificate with the decremented Qty and Value */
                            oCertificate.MAX_QTY = nCertMaxQty;
                            oCertificate.MAX_VALUE = nCertMaxValue;
                            certificateApplied = true;

                            /* If the certificate only has Qty then we decrement only the Qty. */
                        } else if(nCertMaxQty) {

                            oCertificate.MAX_QTY = (nLineQty <= nCertMaxQty) ? nCertMaxQty - nLineQty : 0;
                            nLineQty = (nLineQty <= nCertMaxQty) ? 0 : nLineQty - nCertMaxQty;
                            certificateApplied = true;

                            /* If the certificate only has Value then we decrement only the Value. */
                        } else if (nCertMaxValue) {

                            oCertificate.MAX_VALUE = (nLineValue <= nCertMaxValue) ? nCertMaxValue - nLineValue : 0;
                            nLineValue = (nLineValue <= nCertMaxValue) ? 0 : nLineValue - nCertMaxValue;
                            certificateApplied = true;
                        }

                        oCertificate.TO_DECREMENT = true;
                    }
                });

                oLineData.CERT_APPLIED_ON = (certificateApplied) ? new Date() : '';
            }
        });

        var CERT_FIELDS = ['MAX_VALUE', 'MAX_QTY', 'STATUS'];

        /* Updating the Export Certificates */
        oExportCertificates.forEach(function (oCertificate) {

            if (!oCertificate.TO_DECREMENT) {

                return;
            }

            /* Updating the Certificate Status and respecting the previously empty fields if any */
            oCertificate.STATUS = ((oCertificate.MAX_QTY !== '' && !Number(oCertificate.MAX_QTY)) || (oCertificate.MAX_VALUE !== '' && !Number(oCertificate.MAX_VALUE))) ?
                EXPORT_CERT_STATUS.TERMINATED : EXPORT_CERT_STATUS.ACTIVE;

            oCertificate.MAX_QTY = (oCertificate.MAX_QTY !== '' || oCertificate.MAX_QTY) ? Number(oCertificate.MAX_QTY) : '';
            oCertificate.MAX_VALUE = (oCertificate.MAX_VALUE !== '' || oCertificate.MAX_VALUE) ? Number(oCertificate.MAX_VALUE) : '';

            var oCertValues = {};
            CERT_FIELDS.forEach(function (sField) {
                oCertValues[EXPORT_CERT_REC_MAP[sField]] = oCertificate[sField];
            });

            record.submitFields({
                type: EXPORT_CERT_RECORD,
                id: oCertificate.CERTIFICATE,
                values: oCertValues,
                options: {
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                }
            });
        });

        return pExportCertRestrictions;
    }

    /**
     * Loop and updates lines with CERT APPLIED ON values and saves the given record.
     *
     * @param {Object} pRec
     * @param {Object[]} pLinesData
     * */
    function updateRecordCertLines(pRec, pLinesData) {

        /* Updating Cert Lines */
        pLinesData.forEach(function (oLineData) {

            var nLine = pRec.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: SALES_ORDER_LINE_FIELDS.LINE_KEY,
                value: oLineData.LINE_KEY
            });

            if (nLine !== -1) {

                if (oLineData.CERT_APPLIED_ON) {

                    pRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: SALES_ORDER_LINE_FIELDS.CERT_APPLIED_ON,
                        line: nLine,
                        value: oLineData.CERT_APPLIED_ON
                    });
                }
            }
        });

        pRec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    /**
     * Given a customer ID find the total of their pending fulfillment sales orders
     *
     * @param {string} custId - The customer record idea
     *
     * @returns {number} - 3141.59
     */
    function getPendingFulfillmentOrderTotal(custId) {

        var nResult = Number.MAX_VALUE;

        const FILTERS = [
            { name: 'type', operator: search.Operator.ANYOF, values: [ 'SalesOrd' ]  },
            { name: 'name', operator: search.Operator.ANYOF, values: [custId] },
            { name: 'shiprecvstatusline', operator: search.Operator.IS, values: false },
            { name: 'type', join: 'item', operator: search.Operator.ANYOF, values: ['InvtPart', 'NonInvtPart', 'Service'] }
        ];

        var aFilters = [];
        FILTERS.forEach(function(condition) {
            aFilters.push(
                search.createFilter(condition)
            );
        });

        try {

            search.create({
                type: record.Type.SALES_ORDER,
                filters: aFilters,
                columns: [ search.createColumn({name: 'amount', summary: 'SUM', label: 'amount'}) ]
            }).run().each(function (pendingTotal) {
                nResult = parseFloat(pendingTotal.getValue({name: 'amount', summary: 'SUM'})) || 0.0;
            });

        } catch (e) {

            log.error({
                title: 'getPendingFulfillmentOrderTotal for ' + custId,
                details: e
            });
        }

        return nResult;
    }

    /**
     * Given a customer ID find the total of their open invoices
     *
     * @param {string} custId - The customer record idea
     *
     * @returns {number} - 3141.59
     */
    function getOpenInvoiceTotal(custId) {

        var nResult = Number.MAX_VALUE;

        var aFilters = [
            ['type', search.Operator.ANYOF, [ 'CustInvc' ] ],
            'AND',
            ['mainline', search.Operator.IS, true],
            'AND',
            ['name', search.Operator.ANYOF, [custId]]
        ];

        try {

            search.create({
                type: record.Type.INVOICE,
                filters: aFilters,
                columns: [ search.createColumn({name: 'amount', summary: 'SUM', label: 'amount'}) ]
            }).run().each(function (invoiceTotal) {
                nResult = parseFloat(invoiceTotal.getValue({name: 'amount', summary: 'SUM'})) || 0;
            });

        } catch (e) {

            log.error({
                title: 'getOpenInvoiceTotal for ' + custId,
                details: e
            });
        }

        return nResult;
    }

    /**
     * Given a customer ID find their credit status
     *
     * @param {string} custId - The customer record id
     *
     * @returns {Object} - {valid: true, remainingCredit: 1000.00 } || {valid: false, remainingCredit: "Customer is On Hold"}
     */
    function getRemainingCredit (custId) {

        var oCreditStatus = { valid: true };
        var oCustomerInfo = { id: custId };

        if ( isNaN( parseInt(custId) ) ) {
            throw "getRemainingCredit requires a customer ID value: " + custId;
        }

        // lookupFields is useless for this because it only returns true/false for creditholdoverride
        // AUTO, ON -> false,  OFF -> true

        var oCustomer = record.load({
            type: record.Type.CUSTOMER,
            id: custId,
            isDynamic: false
        });

        oCustomerInfo.creditholdoverride =  oCustomer.getValue({fieldId: 'creditholdoverride'}) || "AUTO";
        oCustomerInfo.creditlimit = parseFloat(oCustomer.getValue({fieldId: 'creditlimit'})) || 0;

        log.debug({title: 'oCustomerInfo', details: oCustomerInfo});

        if ('OFF' == oCustomerInfo.creditholdoverride) {
            return oCreditStatus;
        }

        if ('ON' == oCustomerInfo.creditholdoverride) {
            oCreditStatus.valid = false;
            oCreditStatus.message = 'Customer is On Hold';
            oCreditStatus.remainingCredit = oCreditStatus.message;

            return oCreditStatus;
        }

        // Customer is on AUTO creditholdoverride
        var nTotalOrders = getOpenInvoiceTotal(custId);

        log.debug({title: 'nTotalOrders', details: nTotalOrders});

        if (runtime.getCurrentUser().getPreference ({ name: 'CUSTCREDLIMORDERS' }) ) {
            nTotalOrders = nTotalOrders + getPendingFulfillmentOrderTotal(custId);

            log.debug({title: 'nTotalOrders CUSTCREDLIMORDERS', details: nTotalOrders});
        }

        oCreditStatus.remainingCredit = Number((oCustomerInfo.creditlimit - nTotalOrders).toFixed(2));

        oCreditStatus.valid = oCreditStatus.remainingCredit > 0;

        return oCreditStatus;
    }

    /**
     * Loops through the lines of a given sublist and return an array of objects with the data for a given fields
     * object.
     * Note: This function is generic enough to get almost any sublist data as long as you past the needed params.
     *
     * @param {Object} pRec
     * @param {string} pSublistId
     * @param {Object} pFields
     *
     * @return {Object[]}
     * */
    function getSublistData(pRec, pSublistId, pFields) {

        var oLinesData = [];

        var nLines = pRec.getLineCount({
            sublistId: pSublistId
        });

        for (var nLine = 0; nLine < nLines; nLine++) {

            var oData = {};
            for (var sField in pFields) {

                if (pFields[sField]) {

                    oData[sField] = pRec.getSublistValue({
                        sublistId: pSublistId,
                        fieldId: pFields[sField],
                        line: nLine
                    });
                }
            }

            oData.LINE_IDX = nLine;
            oData.RATE = (oData.QUANTITY) ? Number(oData.AMOUNT) / Number(oData.QUANTITY) : Number(oData.AMOUNT);
            oData.QUANTITY_REQUESTED =  (Number(oData.QUANTITY_COMMITTED)) ? Number(oData.QUANTITY) - Number(oData.QUANTITY_COMMITTED) : Number(oData.QUANTITY);

            oLinesData.push(oData);
        }

        return oLinesData;
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
            STATE: 'state',
            ZIP_CODE: 'zip',
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
     * Returns an object with the given record body data for a given fields object.
     *
     * @param {Object} pRec
     * @param {Object} pFields
     *
     * @return {Object}
     * */
    function getBodyData(pRec, pFields) {

        var oBodyData = {};
        for (var sField in pFields) {

            oBodyData[sField] = pRec.getValue({
                fieldId: pFields[sField]
            });
        }

        var oShipData = getShippingAddressData(pRec);
        oBodyData = util.extend(oBodyData, oShipData);

        if (oBodyData.STATE) {

            var sCountryId = (oBodyData.COUNTRY) ? oBodyData.COUNTRY : '';

            oBodyData.STATE = (isNaN(oBodyData.STATE)) ?  getStateData(oBodyData.STATE, sCountryId).id : oBodyData.STATE;
        }

        if (oBodyData.COUNTRY) {

            oBodyData.COUNTRY = (isNaN(oBodyData.COUNTRY)) ? getCountryId(oBodyData.COUNTRY): oBodyData.COUNTRY;
        }

        return oBodyData;
    }

    /**
     * Perform a SuiteQL Query and return the country ID for a given country name.
     *
     * @param {string} pCountry
     *
     * @return {string}
     * */
    function getCountryId(pCountry) {

        const sQuery = 'SELECT uniquekey FROM country WHERE id = ?';

        const oResults = query.runSuiteQL({
            query: sQuery,
            params: [pCountry]
        }).asMappedResults();

        return oResults.length ? oResults[0].uniquekey : '';
    }

    /**
     * Searches and return a given State data.
     *
     * @param {string} pState
     * @param {string} pCountry
     *
     * @return {Object}
     * */
    function getStateData(pState, pCountry) {

        var aFilters = [];
        aFilters.push(
            search.createFilter({
                name    : 'inactive',
                operator: search.Operator.IS,
                values  : false
            })
        );
        if (pCountry) {

            aFilters.push(
                search.createFilter({
                    name    : 'country',
                    operator: search.Operator.ANYOF,
                    values  : pCountry
                })
            );
        }

        if (pState.length > 2) {
            aFilters.push(
                search.createFilter({
                    name    : 'fullname',
                    operator: search.Operator.IS,
                    values  : pState
                })
            );
        } else {
            aFilters.push(
                search.createFilter({
                    name    : 'shortname',
                    operator: search.Operator.IS,
                    values  : pState
                })
            );
        }

        var aColumns = [];
        aColumns.push(
            search.createColumn({name: 'id'})
        );
        aColumns.push(
            search.createColumn({name: 'fullname'})
        );
        aColumns.push(
            search.createColumn({name: 'shortname'})
        );

        var oSearch = search.create({
            type   : search.Type.STATE,
            filters: aFilters,
            columns: aColumns
        });

        var oStateData = {
            id: '',
            fullname: '',
            shortname: ''
        };
        oSearch.run().each(function(oResult) {

            oStateData.id = oResult.getValue({name: 'id'});
            oStateData.fullname = oResult.getValue({name: 'fullname'});
            oStateData.shortname = oResult.getValue({name: 'shortname'});
        });

        return oStateData
    }

    /**
     * Builds an array with the Items IDs from a given array of object(Record Data), searches and updates the given
     * array of objects with the Items Data.
     *
     * @param {Object[]} pRecordData
     *
     * @return {Object[]}
     * */
    function getItemsData(pRecordData) {

        const oColumnsMap = {
            ITEM: {name: 'internalid'},
            ITEM_NAME: {name: 'itemid'},
            ECCN: {name: 'custitem_360_eccn'},
            MAP: {name: 'custitem_min_price'}
        };

        /* Building an Array of Items IDs */
        var aItemIds = [];
        pRecordData.forEach(function (oData) {

            if (oData.ITEM && aItemIds.indexOf(oData.ITEM) === -1) {

                aItemIds.push(oData.ITEM);
            }
        });

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
                name: 'internalid',
                operator: search.Operator.ANYOF,
                values: aItemIds
            })
        );

        var aColumns = [];
        for (var sColumn in oColumnsMap) {

            aColumns.push(search.createColumn(oColumnsMap[sColumn]));
        }

        var oSearch = search.create({
            type: search.Type.ITEM,
            filters: aFilters,
            columns: aColumns
        });

        var oItemsData = {};
        oSearch.run().each(function (oResult) {

            var oData = {};
            for (var sColumn in oColumnsMap) {

                oData[sColumn] = oResult.getValue(oColumnsMap[sColumn]);
            }

            oItemsData[oData.ITEM] = oData;

            return true;
        });

        /* Updating the given Array of Objects with the Items Data */
        pRecordData.forEach(function (oData) {

            if (oItemsData.hasOwnProperty(oData.ITEM)) {

                for (var sField in oColumnsMap) {

                    oData[sField] = oItemsData[oData.ITEM][sField];
                }
            }
        });

        return pRecordData;
    }

    /**
     * - Gets a given customer price level and any Pricing Item.
     * - Searches for Items Pricing and updated any matching Item found in the Customer.
     *
     * @param {Object[]} pRecordData
     *
     * @return {Object[]}
     * */
    function getPricingRestrictions(pRecordData) {

        /* Getting the Price Tolerance Value */
        var sPriceTolerance = runtime.getCurrentUser().getPreference({name: 'custscript_360_sku_rest_price_tolerance'});

        /* Getting the Customer ID */
        var sCustomerId= pRecordData[0].CUSTOMER || '';

        if (!sPriceTolerance || !sCustomerId) {

            return [];
        }

        /* Getting the Customer Price Level and Pricing Items */
        var oCustColumnMap = {
            PRICE_LEVEL: {name: 'pricelevel'},
            ITEM: {name: 'pricingitem'},
            PRICE: {name: 'itempricingunitprice'}
        };

        var aCustFilters = [];
        aCustFilters.push(
            search.createFilter({
                name: 'internalid',
                operator: search.Operator.ANYOF,
                values: sCustomerId
            })
        );

        var aCustColumns = [];
        for(var sCustColumn in oCustColumnMap) {
            aCustColumns.push(search.createColumn(oCustColumnMap[sCustColumn]));
        }

        var oCustSearch = search.create({
            type: search.Type.CUSTOMER,
            filters: aCustFilters,
            columns: aCustColumns
        });

        var sCustomerPriceLevel = '';
        var oCustPricingData = {};
        oCustSearch.run().each(function (oResult) {

            var oCustData = {};
            for (var sCustColumn in oCustColumnMap) {

                oCustData[sCustColumn] = oResult.getValue(oCustColumnMap[sCustColumn]);
            }

            oCustPricingData[oCustData.ITEM] = oCustData;
            if (!sCustomerPriceLevel) {

                sCustomerPriceLevel = oCustData.PRICE_LEVEL
            }

            return true;
        });

        if (!sCustomerPriceLevel) {

            return [];
        }

        /* Getting the Items Pricing Data */
        const oColumnsMap = {
            ITEM: {name: 'item'},
            ITEM_NAME: {name: 'itemid', join: 'item'},
            PRICE: {name: 'unitprice'}
        };

        var aFilters = [];
        aFilters.push(
            search.createFilter({
                name: 'pricelevel',
                operator: search.Operator.ANYOF,
                values: sCustomerPriceLevel
            })
        );

        var aColumns = [];
        for (var sColumn in oColumnsMap) {

            aColumns.push(search.createColumn(oColumnsMap[sColumn]));
        }

        var oSearch = search.create({
            type: search.Type.PRICING,
            filters: aFilters,
            columns: aColumns
        });

        var oPricingData = {};
        var oPagedSearch = oSearch.runPaged({pageSize: 1000});
        oPagedSearch.pageRanges.forEach(function (pageRange) {

            var oPage = oPagedSearch.fetch({index: pageRange.index});

            oPage.data.forEach(function (oResult) {

                var oData = {};
                for (var sColumn in oColumnsMap) {

                    oData[sColumn] = oResult.getValue(oColumnsMap[sColumn]);
                }

                oPricingData[oData.ITEM_NAME] = oData;

                return true;
            });
        });

        /* Defining Valid Price Violations */
        var oValidPriceViolations = [];
        pRecordData.forEach(function (oData) {

            if (oPricingData.hasOwnProperty(oData.ITEM_NAME)) {

                for (var sField in oColumnsMap) {

                    oData[sField] = oPricingData[oData.ITEM_NAME][sField];
                }

                /* Updating Pricing Data Price with the Customer Pricing Data if any */
                if (oCustPricingData.hasOwnProperty(oData.ITEM_NAME)) {

                    oPricingData[oData.ITEM_NAME].PRICE = (oCustPricingData[oData.ITEM_NAME].PRICE) ?
                        oCustPricingData[oData.ITEM_NAME].PRICE : oPricingData[oData.ITEM_NAME].PRICE;

                    oData.PRICE = (oCustPricingData[oData.ITEM_NAME].PRICE) ?
                        oCustPricingData[oData.ITEM_NAME].PRICE : oPricingData[oData.ITEM_NAME].PRICE;
                }

                if(Math.abs(Number(oData.RATE) - Number(oPricingData[oData.ITEM_NAME].PRICE)) > Number(sPriceTolerance)) {

                    oValidPriceViolations.push(oData);
                }
            }
        });

        return oValidPriceViolations;
    }

    /**
     * Searches and returns the location's quantities per item.
     *
     * @param {Object[]} pRecordData
     * @param {Object[]} pOldRecordData
     *
     * @return {Object[]}
     * */
    function getItemsAvailableQuantities(pRecordData, pOldRecordData) {

        const oColumnsMap = {
            ITEM: {name: 'internalid', summary: search.Summary.GROUP},
            ITEM_NAME: {name: 'itemid', summary: search.Summary.GROUP},
            LOCATION: {name: 'inventorylocation', summary: search.Summary.GROUP},
            LOCATION_QTY_AVAILABLE: {name: 'locationquantityavailable', summary: search.Summary.SUM},
            LOCATION_QTY_BACKORDERED: {name: 'locationquantitybackordered', summary: search.Summary.SUM},
            LOCATION_QTY_ORDERED: {name: 'locationquantityonorder', summary: search.Summary.SUM}
        };

        /* Building an Array of Items IDs and Item Map */
        var aItemIds = [];
        var oItemsDataMap = {};
        var oOldItemsDataMap = {};
        pRecordData.forEach(function (oData) {

            if ((oData.ITEM && oData.LOCATION) && aItemIds.indexOf(oData.ITEM) === -1) {

                aItemIds.push(oData.ITEM);
                oItemsDataMap[oData.ITEM] = oData;
            }
        });

        if (pOldRecordData.length) {

            pOldRecordData.forEach(function (oData) {

                if ((oData.ITEM && oData.LOCATION)) {

                    oOldItemsDataMap[oData.ITEM] = oData;
                }
            });
        }

        if (aItemIds.length === 0) {

            return [];
        }

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
                name: 'internalid',
                operator: search.Operator.ANYOF,
                values: aItemIds
            })
        );

        var aColumns = [];
        for (var sColumn in oColumnsMap) {

            aColumns.push(search.createColumn(oColumnsMap[sColumn]));
        }

        var oSearch = search.create({
            type: search.Type.ITEM,
            filters: aFilters,
            columns: aColumns
        });

        var oQuantitiesData = {};
        oSearch.run().each(function (oResult) {

            var oData = {};
            for (var sColumn in oColumnsMap) {

                oData[sColumn] = oResult.getValue(oColumnsMap[sColumn]);
            }

            /* Grouping by Item */
            (oQuantitiesData[oData.ITEM] || (oQuantitiesData[oData.ITEM] = [])).push(oData);

            return true;
        });

        var oItemsQuantityAvailable = [];
        /* Calculating the Max Allowed Quantity per Item */
        for (var sItem in oQuantitiesData) {

            if (MAX_ALLOWED_QUANTITY_LIFECYCLES.indexOf(oItemsDataMap[sItem].LIFECYCLE) !== -1) {

                var oItemData = oItemsDataMap[sItem];
                var nOrderedTotal = 0;
                var nLocationAvailable = 0;
                var nLocationBackOrdered = 0;

                for (var nLocation = 0; nLocation < oQuantitiesData[sItem].length; nLocation++) {

                    nOrderedTotal += Number(oQuantitiesData[sItem][nLocation].LOCATION_QTY_ORDERED);
                    if (oItemsDataMap[sItem].LOCATION === oQuantitiesData[sItem][nLocation].LOCATION) {

                        nLocationAvailable = Number(oQuantitiesData[sItem][nLocation].LOCATION_QTY_AVAILABLE);
                        nLocationBackOrdered = Number(oQuantitiesData[sItem][nLocation].LOCATION_QTY_BACKORDERED);
                    }
                }

                /* Deducting the Old Record Quantity from the Ordered Total if needed */
                if (oOldItemsDataMap.hasOwnProperty(sItem)) {

                    nLocationBackOrdered -= Number(oOldItemsDataMap[sItem].QUANTITY);
                }

                oItemData.MAX_ALLOWED_QTY = (nLocationAvailable + nOrderedTotal) - nLocationBackOrdered;
                oItemsQuantityAvailable.push(oItemData);
            }
        }

        return oItemsQuantityAvailable;
    }

    /**
     * Searches and return true or false if an order is found matching the given data.
     *
     * @param {string} pRecordId
     * @param {Object} pAddressData
     *
     * @return {Boolean}
     * */
    function getExistingOrder(pRecordId, pAddressData) {

        const oColumnsMap = {
            ID: {name: 'internalid'}
        };

        var aFilters = [];
        aFilters.push(
            search.createFilter({
                name: 'mainline',
                operator: search.Operator.IS,
                values: true
            })
        );
        if (pRecordId) {
            aFilters.push(
                search.createFilter({
                    name: 'internalid',
                    operator: search.Operator.NONEOF,
                    values: pRecordId
                })
            );
        }
        aFilters.push(
            search.createFilter({
                name: 'name',
                operator: search.Operator.ANYOF,
                values: pAddressData.CUSTOMER
            })
        );
        aFilters.push(
            search.createFilter({
                name: 'otherrefnum',
                operator: search.Operator.EQUALTO,
                values: pAddressData.PO_NUMBER
            })
        );

        if (pAddressData.ADDRESS1) {

            aFilters.push(
                search.createFilter({
                    name: 'address1',
                    join: 'shippingaddress',
                    operator: search.Operator.IS,
                    values: pAddressData.ADDRESS1
                })
            );
        }

        if (pAddressData.ADDRESS2) {

            aFilters.push(
                search.createFilter({
                    name: 'address2',
                    join: 'shippingaddress',
                    operator: search.Operator.IS,
                    values: pAddressData.ADDRESS2
                })
            );
        }

        if (pAddressData.ZIP) {

            aFilters.push(
                search.createFilter({
                    name: 'zip',
                    join: 'shippingaddress',
                    operator: search.Operator.IS,
                    values: pAddressData.ZIP
                })
            );
        }

        var aColumns = [];
        aColumns.push(search.createColumn(oColumnsMap.ID));

        var oSearch = search.create({
            type: search.Type.SALES_ORDER,
            filters: aFilters,
            columns: aColumns
        });

        var notDuplicate = true;
        oSearch.run().each(function (oResult) {

            notDuplicate = (!oResult.id);
        });

        return notDuplicate;
    }

    /**
     * Searches and return an array of objects with the restrictions matching any Item or ECCN.
     *
     * @param {Object[]} pData
     * @param {string} pCustomerId
     *
     * @return {Object[]}
     * */
    function getSkuRestrictions(pData, pCustomerId) {

        /* Building arrays of Items and ECCNs */
        var aItems = [];
        var aECCN = [];
        pData.forEach(function (oData) {

            if (oData.ITEM && aItems.indexOf(oData.ITEM) === -1) {

                aItems.push(oData.ITEM);
            }

            if (oData.ECCN && aECCN.indexOf(oData.ECCN) === -1) {

                aECCN.push(oData.ECCN);
            }
        });

        var aFiltersExpression = [
            ['isinactive', search.Operator.IS, false],
            'AND'
        ];

        if (pCustomerId) {
            aFiltersExpression.push(
                [SKU_REST_REC_MAP.CUSTOMER, search.Operator.ANYOF, pCustomerId]
            );
            aFiltersExpression.push('AND');
        }

        /* Adding the Outer Parenthesis to hold the OR expressions */
        var nOrParenthesisPOS = aFiltersExpression.push([]) -1;

        if (aItems.length > 0 && aECCN.length > 0) {

            aFiltersExpression[nOrParenthesisPOS].push(
                [
                    [SKU_REST_REC_MAP.ITEM, search.Operator.ANYOF, aItems],
                    "OR",
                    ["formulanumeric: CASE WHEN {" + SKU_REST_REC_MAP.ECCN + "} IN ('" + aECCN.join("','") + "') THEN 1 ELSE 0 END", search.Operator.GREATERTHAN, '0']
                ]
            );

        } else {

            aFiltersExpression[nOrParenthesisPOS].push(
                [
                    [SKU_REST_REC_MAP.ITEM, search.Operator.ANYOF, aItems]
                ]
            );
        }

        var aColumns = [];
        var oColumnsDefinition = {};
        for (var sField in SKU_REST_REC_MAP) {

            oColumnsDefinition[sField] = search.createColumn({name: SKU_REST_REC_MAP[sField]});
            aColumns.push(oColumnsDefinition[sField]);
        }

        var oSearch = search.create({
            type: SKU_RESTRICTIONS_RECORD,
            filters: aFiltersExpression,
            columns: aColumns
        });

        var oRestrictions = [];
        var oPagedSearch = oSearch.runPaged({pageSize: 1000});
        oPagedSearch.pageRanges.forEach(function (pageRange) {

            var oPage = oPagedSearch.fetch({index: pageRange.index});

            oPage.data.forEach(function (oResult) {

                var oData = {};
                for (var sField in SKU_REST_REC_MAP) {

                    oData[sField] = oResult.getValue(oColumnsDefinition[sField]);
                }

                if (oData.ITEM) {

                    oData.ITEM_NAME = oResult.getText({name: SKU_REST_REC_MAP.ITEM_NAME});
                }

                oRestrictions.push(oData);

                return true;
            });
        });

        return oRestrictions;
    }

    /**
     * Searches and return an array of objects with the Export Certificates Data matching any Item/ECCN with a given
     * customer.
     *
     * @param {Object[]} pRestrictionData
     *
     * @return {Object[]}
     * */
    function getExportCertificates(pRestrictionData) {

        var nTimeToShip = runtime.getCurrentUser().getPreference({name: 'custscript_360_sku_rest_time_to_ship'});
        if (!Number(nTimeToShip)) {

            return [];
        }

        var oColumnsMap = {
            CERTIFICATE: {name: 'internalid'},
            CUSTOMER: {name: EXPORT_CERT_REC_MAP.CUSTOMER},
            ITEM: {name: EXPORT_CERT_REC_MAP.ITEM},
            ITEM_NAME: {name: EXPORT_CERT_REC_MAP.ITEM_NAME},
            ECCN: {name: EXPORT_CERT_REC_MAP.ECCN},
            EXP_DATE: {name: EXPORT_CERT_REC_MAP.EXP_DATE, sort: search.Sort.ASC},
            MAX_VALUE: {name: EXPORT_CERT_REC_MAP.MAX_VALUE},
            MAX_QTY: {name: EXPORT_CERT_REC_MAP.MAX_QTY},
            STATUS: {name: EXPORT_CERT_REC_MAP.STATUS}
        }

        /* Building arrays of Items and ECCNs */
        var aItems = [];
        var aECCN = [];
        pRestrictionData.forEach(function (oData) {

            if (oData.ITEM && aItems.indexOf(oData.ITEM) === -1) {

                aItems.push(oData.ITEM);
            }

            if (oData.ECCN && aECCN.indexOf(oData.ECCN) === -1) {

                aECCN.push(oData.ECCN);
            }
        });

        if (!aItems.length && !aECCN.length) {

            return [];
        }

        var sExportCertExpDate = moment(new Date()).add(Number(nTimeToShip), 'days').format('MM/DD/YYYY');

        var aFiltersExpression = [
            ['isinactive', search.Operator.IS, false],
            'AND',
            [EXPORT_CERT_REC_MAP.STATUS, search.Operator.ANYOF, EXPORT_CERT_STATUS.ACTIVE],
            'AND',
            [EXPORT_CERT_REC_MAP.EXP_DATE, search.Operator.ONORAFTER, sExportCertExpDate],
            'AND'
        ];

        if (pRestrictionData[0].CUSTOMER) {
            aFiltersExpression.push(
                [EXPORT_CERT_REC_MAP.CUSTOMER, search.Operator.ANYOF, pRestrictionData[0].CUSTOMER]
            );
            aFiltersExpression.push('AND');
        }

        /* Adding the Outer Parenthesis to hold the OR expressions */
        var nOrParenthesisPOS = aFiltersExpression.push([]) -1;

        if (aItems.length && aECCN.length) {

            aFiltersExpression[nOrParenthesisPOS].push(
                [
                    [EXPORT_CERT_REC_MAP.ITEM, search.Operator.ANYOF, aItems],
                    "OR",
                    ["formulanumeric: CASE WHEN {" + EXPORT_CERT_REC_MAP.ECCN + "} IN ('" + aECCN.join("','") + "') THEN 1 ELSE 0" +
                    " END", search.Operator.GREATERTHAN, '0']
                ]
            );

        } else {

            aFiltersExpression[nOrParenthesisPOS].push(
                [
                    [EXPORT_CERT_REC_MAP.ITEM, search.Operator.ANYOF, aItems]
                ]
            );

        }

        var aColumns = [];
        var oColumnsDefinition = {};
        for (var sColumn in oColumnsMap) {

            oColumnsDefinition[sColumn] = search.createColumn(oColumnsMap[sColumn]);
            aColumns.push(oColumnsDefinition[sColumn]);
        }

        var oSearch = search.create({
            type: EXPORT_CERT_RECORD,
            filters: aFiltersExpression,
            columns: aColumns
        });

        var oExportCertificates = [];
        var oPagedSearch = oSearch.runPaged({pageSize: 1000});
        oPagedSearch.pageRanges.forEach(function (pageRange) {

            var oPage = oPagedSearch.fetch({index: pageRange.index});

            oPage.data.forEach(function (oResult) {

                var oData = {};
                for (var sColumn in oColumnsMap) {

                    oData[sColumn] = oResult.getValue(oColumnsDefinition[sColumn]);
                }

                if (oData.ITEM) {

                    oData.ITEM_NAME = oResult.getText(oColumnsMap.ITEM_NAME);
                }

                oExportCertificates.push(oData);

                return true;
            });
        });

        return oExportCertificates;
    }

    /**
     * Searches and return an array of objects with the restrictions matching a given customer with restriction
     * Restriction Type = Customer cannot purchase this item.
     *
     * @param {string} pCustomerId
     *
     * @return {Object[]}
     * */
    function getCustomerSkuRestrictions(pCustomerId) {

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
                name: SKU_REST_REC_MAP.CUSTOMER,
                operator: search.Operator.ANYOF,
                values: pCustomerId
            })
        );
        aFilters.push(
            search.createFilter({
                name: SKU_REST_REC_MAP.TYPE,
                operator: search.Operator.ANYOF,
                values: '2' // Customer cannot purchase this item.
            })
        );

        var aColumns = [];
        var oColumnsDefinition = {};
        for (var sField in SKU_REST_REC_MAP) {

            oColumnsDefinition[sField] = search.createColumn({name: SKU_REST_REC_MAP[sField]});
            aColumns.push(oColumnsDefinition[sField]);
        }

        var oSearch = search.create({
            type: SKU_RESTRICTIONS_RECORD,
            filters: aFilters,
            columns: aColumns
        });

        var oRestrictions = [];
        var oPagedSearch = oSearch.runPaged({pageSize: 1000});
        oPagedSearch.pageRanges.forEach(function (pageRange) {

            var oPage = oPagedSearch.fetch({index: pageRange.index});

            oPage.data.forEach(function (oResult) {

                var oData = {};
                for (var sField in SKU_REST_REC_MAP) {

                    oData[sField] = oResult.getValue(oColumnsDefinition[sField]);
                }

                if (oData.ITEM) {

                    oData.ITEM_NAME = oResult.getText({name: SKU_REST_REC_MAP.ITEM_NAME});
                }

                oRestrictions.push(oData);

                return true;
            });
        });

        return oRestrictions;
    }

    /**
     * Resolves and returns the URL for a given record object/data.
     *
     * @param {Object} paramSLData
     * @param {Boolean} paramExternal
     *
     * @return {string}
     */
    function getSLURL(paramSLData, paramExternal) {

        paramSLData.returnExternalUrl = paramExternal;

        return url.resolveScript(paramSLData);
    }

    /**
     * Creates Violation Logs records
     *
     * @param {Object} pViolations
     * */
    function createViolationLogs(pViolations) {

        pViolations.forEach(function (oData) {

            if (!oData.OVERRIDE) {

                var oRec = record.create({
                    type: SKU_VIOLATION_LOG_RECORD,
                    isDynamic: true
                });

                for (var sField in oData) {

                    if (oData[sField]) {

                        if (SKU_VIOLATION_LOG_REC_MAP.hasOwnProperty(sField)) {

                            if (sField === 'ORDER_DATE') {

                                oData[sField] = new Date(oData[sField]);
                            }

                            oRec.setValue({
                                fieldId: SKU_VIOLATION_LOG_REC_MAP[sField],
                                value: oData[sField]
                            });
                        }
                    }
                }

                var sViolationId = oRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                if (sViolationId) {

                    log.audit({
                        title: 'Violation Log Created',
                        details:  'Violation Log successfully created with ID: ' + sViolationId
                    });
                }
            }
        });
    }

    /**
     * Loads a given Sales Order and updates the lines rate with the value of the System Price(custom column/line
     * field);
     *
     * @param {string} pSalesOrderId
     *
     * */
    function updateOrderLinesPrice(pSalesOrderId) {

        var oRec = record.load({
            type: record.Type.SALES_ORDER,
            id: pSalesOrderId,
            isDynamic: false
        });

        var nLines = oRec.getLineCount({
            sublistId: 'item'
        });

        for (var nLine= 0; nLine < nLines; nLine++) {

            var lineSystemPrice = oRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_360_system_price',
                line: nLine
            });

            if(!lineSystemPrice) {

                continue;
            }

            oRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'price',
                value: -1,
                line: nLine
            });

            oRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'rate',
                value: Number(lineSystemPrice),
                line: nLine
            });

            oRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_360_system_price',
                value: '',
                line: nLine
            });
        }

        oRec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    /**
     * Lookup and return the value of a given customer Approved for Map Items(Custom Checkbox).
     *
     * @param {string} pCustomerId
     *
     * @return {Boolean}
     * */
    function getCustomerMapApproval(pCustomerId) {

        return search.lookupFields({
            type: search.Type.CUSTOMER,
            id: pCustomerId,
            columns: [APPROVED_FOR_MAP_ITEMS]
        })[APPROVED_FOR_MAP_ITEMS] || false;
    }

    /**
     * Load the Request XML and return the content.
     *
     * @return {string}
     * */
    function loadRequestXML() {

        var oFile = file.load({
            id: './360VISTA_VertexRequest.xml'
        });

        return oFile.getContents();
    }

    /**
     * Build an XML Payload to be used to make a request to the Vertex API.
     *
     * @param {Object} pShippingData
     *
     * @return {string}
     * */
    function buildRequestPayload(pShippingData) {

        /* Getting the Vertex Trusted ID */
        var sTrustedID = runtime.getCurrentUser().getPreference({name: 'custscript_trustedid_vt'});
        if (!sTrustedID) {

            log.audit({
                title: 'Missing Vertex Trusted ID',
                details: 'Missing Vertex Trusted ID, please check your company preferences, unable to continue,' +
                    ' skipping.'
            });

            return '';
        }

        var sRequestXMLTemplate = loadRequestXML();
        sRequestXMLTemplate = sRequestXMLTemplate.replace('_TRUSTED_ID_', sTrustedID);

        for (var sField in pShippingData) {

            sRequestXMLTemplate = (pShippingData[sField]) ?
                sRequestXMLTemplate.replace('_' + sField + '_', pShippingData[sField]) :
                sRequestXMLTemplate.replace('_' + sField + '_', '')
        }

        return sRequestXMLTemplate;
    }

    /**
     * Builds and return an Object from a given XML Data/String.
     *
     * @param {string} pXMLNode
     *
     * @return {Object}
     * */
    function xmlToJson(pXMLNode) {

        var oXMLData = {};

        if (pXMLNode.nodeType === xml.NodeType.ELEMENT_NODE) {

            if (pXMLNode.hasAttributes()) {

                oXMLData['@attributes'] = {};

                for (var sAttribute in pXMLNode.attributes) {

                    if(pXMLNode.hasAttribute({name : sAttribute})){
                        oXMLData['@attributes'][sAttribute] = pXMLNode.getAttribute({
                            name : sAttribute
                        });
                    }
                }
            }

        } else if (pXMLNode.nodeType === xml.NodeType.TEXT_NODE) {

            oXMLData = pXMLNode.nodeValue;
        }

        if (pXMLNode.hasChildNodes()) {
            for (var nChild = 0; nChild < pXMLNode.childNodes.length; nChild++) {

                var childItem = pXMLNode.childNodes[nChild];
                var nodeName = childItem.nodeName;

                if (oXMLData.hasOwnProperty(nodeName)) {

                    if (!Array.isArray(oXMLData[nodeName])) {

                        oXMLData[nodeName] = [oXMLData[nodeName]];
                    }

                    oXMLData[nodeName].push(xmlToJson(childItem));

                } else {

                    oXMLData[nodeName] = xmlToJson(childItem);
                }
            }
        }

        return oXMLData;
    }

    /**
     * Send a POST request to Vertex API and return an object with the address data from the response with the
     * highest confidence indicator.
     *
     * @param {string} pRequestPayload
     * @param {string} pVertexURL
     *
     * @return {Object}
     * */
    function getAddressDataFromVertex(pRequestPayload) {

        var sVertexURL = runtime.getCurrentUser().getPreference({name: 'custscript_360_sku_rest_ship_val_url'}) || '';
        if (!sVertexURL) {

            log.error({
                title: 'No Vertex Endpoint URL',
                details: 'No Vertex Endpoint URL found please check your company preferences, unable to continue,' +
                    ' skipping.'
            });

            return {};
        }

        var requestResponse =  https.post({
            url: sVertexURL,
            body: pRequestPayload,
            headers: {
                'Content-Type': 'text/xml'
            }
        });

        if (!requestResponse.code || requestResponse.code !== 200) {

            log.error({
                title: 'Error getting Data from Vertex',
                details: 'Unable to get data from Vertex when processing request: '+ pRequestPayload + ' the' +
                    ' response code is: '+ requestResponse.code
            });

            return {};
        }

        /* Converting XML Data to Object */
        var sBodyData = requestResponse.body;
        var oXMLDocument = xml.Parser.fromString({
            text : sBodyData
        });

        var oRequestData = xmlToJson(oXMLDocument);

        var oAddressData = {};
        var oResponseObject = util.extend({}, oRequestData['soapenv:Envelope']['soapenv:Body']['VertexEnvelope']['TaxAreaResponse'] || {});

        if (oResponseObject.hasOwnProperty('TaxAreaResult')) {

            /* If the TaxAreaResult is an Array then no valid address was found */
            if (!util.isArray(oResponseObject['TaxAreaResult'])) {

                if (oResponseObject['TaxAreaResult'].hasOwnProperty('PostalAddress')) {

                    var oRAWPostalAddress = util.extend({}, oResponseObject['TaxAreaResult']['PostalAddress']);
                    oAddressData.ADDRESS1 = (oRAWPostalAddress.hasOwnProperty('StreetAddress1')) ?
                        oRAWPostalAddress['StreetAddress1']['#text'] : '';
                    oAddressData.ADDRESS2 = (oRAWPostalAddress.hasOwnProperty('StreetAddress2')) ?
                        oRAWPostalAddress['StreetAddress2']['#text'] : '';
                    oAddressData.CITY = (oRAWPostalAddress.hasOwnProperty('City')) ?
                        oRAWPostalAddress['City']['#text'] : '';
                    oAddressData.STATE = (oRAWPostalAddress.hasOwnProperty('MainDivision')) ?
                        oRAWPostalAddress['MainDivision']['#text'] : '';
                    oAddressData.ZIP = (oRAWPostalAddress.hasOwnProperty('PostalCode')) ?
                        oRAWPostalAddress['PostalCode']['#text'] : '';
                    oAddressData.COUNTRY = (oRAWPostalAddress.hasOwnProperty('Country')) ?
                        oRAWPostalAddress['Country']['#text'] : '';
                }
            }
        }

        return oAddressData;
    }

    return {
        SALES_ORDER_LINE_FIELDS: SALES_ORDER_LINE_FIELDS,
        SALES_ORDER_BODY_FIELDS: SALES_ORDER_BODY_FIELDS,
        SUITELET: SUITELET,
        SUITELET_ACTIONS: SUITELET_ACTIONS,
        FORBIDDEN_LIFECYCLES: FORBIDDEN_LIFECYCLES,
        MAX_ALLOWED_QTY_REASON_MAP: MAX_ALLOWED_QTY_REASON_MAP,
        decrementCertificates: decrementCertificates,
        updateRecordCertLines: updateRecordCertLines,
        getRemainingCredit: getRemainingCredit,
        getSublistData: getSublistData,
        getBodyData: getBodyData,
        getItemsData: getItemsData,
        getSkuRestrictions: getSkuRestrictions,
        getExportCertificates: getExportCertificates,
        getCustomerSkuRestrictions: getCustomerSkuRestrictions,
        getItemsAvailableQuantities: getItemsAvailableQuantities,
        getPricingRestrictions: getPricingRestrictions,
        updateOrderLinesPrice: updateOrderLinesPrice,
        getExistingOrder: getExistingOrder,
        getSLURL: getSLURL,
        createViolationLogs: createViolationLogs,
        getCustomerMapApproval: getCustomerMapApproval,
        getStateData: getStateData,
        buildRequestPayload: buildRequestPayload,
        getAddressDataFromVertex: getAddressDataFromVertex
    }
});
