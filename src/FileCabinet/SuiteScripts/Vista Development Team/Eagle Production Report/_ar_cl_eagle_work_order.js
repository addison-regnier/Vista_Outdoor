/**
 * @NApiVersion 2.0
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/https', 'N/record', 'N/runtime', 'N/search','N/currentRecord'],
/**
 * @param{https} https
 * @param{record} record
 * @param{runtime} runtime
 * @param{search} search
 * @param{currentRecord} currentRecord
 */
function(https, record, runtime, search, currentRecord) {

    function generateEagleProdReport(){
        //Load customer specific Config
        console.log('made it into Client Script')
        var cr = currentRecord.get();
        var recName = cr.id;



        // var urlForOrderAck = 'https://6912267.app.netsuite.com/app/site/hosting/scriptlet.nl?script=1259&deploy=1';
        //
        // urlForOrderAck += '&reqId=' + recName;
        // var url = 'https://5555330.app.netsuite.com/app/site/hosting/scriptlet.nl?script=1264&deploy=1'
        // url += '&reqId=' + recName;
        // console.log(recName)
        //
        // var response = https.request({
        //     method: https.Method.GET,
        //     url: url
        // });

        window.open(response)

    }

    return {
        saveRecord: function () {
            return true;
        },
        generateEagleProdReport: generateEagleProdReport
    };
    
});
