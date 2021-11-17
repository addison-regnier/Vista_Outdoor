/**
 * This UserEvent:
 * - Check if a Customer has the Fill & Kill checkbox checked.
 * - If the Sales Order status is Pending Fulfillment close all lines.
 *
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 *
 * @copyright 2021, 360 Solutions, LLC
 * @author Alien Torres <atorres@360cloudsolutions.com>
 */
define(['N/search', 'N/record'],

function(search, record) {

    const HELPER = {
        FILL_KILL: 'custentity_360_fill_and_kill',
        OVERRIDE_FILL_KILL: 'custbody_360_override_fill_and_kill',
        RECORD_TYPE: 'recordtype',
        RECORD_STATUS: 'status',
        VALID_STATUS: 'partiallyFulfilled'
    };

    /**
     * Load a given record (Sales Order) and close the lines with remaining quantities
     * (line quantity - fulfilled quantity != 0).
     *
     * @param {string} paramRecordId
     * */
    function closeRemainingLines(paramRecordId) {

        var soRec = record.load({
            type: record.Type.SALES_ORDER,
            id: paramRecordId,
            isDynamic: false
        });

        var nLines = soRec.getLineCount({
            sublistId: 'item'
        });

        for (var nLine = 0; nLine < nLines; nLine++) {

            var lineQuantityFulfilled = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantityfulfilled',
                line: nLine
            });

            var lineQuantity = soRec.getSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: nLine
            });

            if (Number(lineQuantity) !== Number(lineQuantityFulfilled)) {

                soRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'isclosed',
                    line: nLine,
                    value: true
                });
            }
        }

        soRec.save({
            ignoreMandatoryFields: true,
            enableSourcing: true
        });
    }

    /**
     * Function definition to be triggered after record is submitted.
     *
     * @param {Object} context
     * @param {Record} context.newRecord - New record
     * @param {Record} context.oldRecord - Old record
     * @param {string} context.type - Trigger type
     * @Since 2015.2
     */
    function afterSubmit(context) {

        if (context.type !== context.UserEventType.CREATE) {

            return;
        }

        var oRec = context.newRecord;

        var sCreatedFrom = oRec.getValue({
            fieldId: 'createdfrom'
        });

        /* If there is no Created From, we do nothing. */
        if (!sCreatedFrom) {

            return;
        }

        var oCreatedFromLookup = search.lookupFields({
            type: search.Type.TRANSACTION,
            id: sCreatedFrom,
            columns: [HELPER.RECORD_TYPE, HELPER.RECORD_STATUS]
        });

        /* If the Invoices was not created from a Sales Order, we do nothing. */
        if (oCreatedFromLookup[HELPER.RECORD_TYPE] !== record.Type.SALES_ORDER) {

            return;
        }

        /* If the Created From Sales Order status is not Partially Fulfilled, we do nothing. */
        if (!oCreatedFromLookup[HELPER.RECORD_STATUS] ||
            oCreatedFromLookup[HELPER.RECORD_STATUS][0].value !== HELPER.VALID_STATUS) {

            return;
        }

        var isOverrideFillAndKill = oRec.getValue({
            fieldId: HELPER.OVERRIDE_FILL_KILL
        });

        if (isOverrideFillAndKill) {

            return;
        }

        var sCustomerId = oRec.getValue({
            fieldId: 'entity'
        });

        /* If there is no Customer, we do nothing. */
        if (!sCustomerId) {

            return;
        }

        /* Getting Customer's data */
        var oCustomerLookup = search.lookupFields({
            type: search.Type.CUSTOMER,
            id: sCustomerId,
            columns: [HELPER.FILL_KILL]
        });

        var isFillAndKill = oCustomerLookup[HELPER.FILL_KILL];

        /* If the Customer does not have the Fill and Kill checkbox checked, we do nothing. */
        if (!isFillAndKill) {

            return;
        }

        closeRemainingLines(sCreatedFrom);
    }

    return {
        afterSubmit: afterSubmit
    };
});
