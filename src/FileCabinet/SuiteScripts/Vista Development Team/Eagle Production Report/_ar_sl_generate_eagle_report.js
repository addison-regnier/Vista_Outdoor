/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/render', 'N/runtime', 'N/search','N/dataset'],
    /**
 * @param{render} render
 * @param{runtime} runtime
 * @param{search} search
     * @param{dataset} dataset
 */
    (render, runtime, search,dataset) => {
        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            // let recId = scriptContext.request.parameters['reqId'];
            // log.debug({
            //     title: 'Made it to Suitelet',
            //     details: recId
            // })
            //
            //
            // let html = '<p>Hello World</p>'
            //
            //
            //
            //
            //
            var xml = '<?xml version=\"1.0\"?>\n<!DOCTYPE pdf PUBLIC \"-//big.faceless.org//report\" \"report-1.1.dtd\">\n';
            xml += '<pdf>';
            xml += '<link name="verdana" type="font" subtype="opentype" src="${nsfont.verdana}" src-bold="${nsfont.verdana_bold}" bytes="2" />';
            xml += '<head>';
            xml += '<meta name="title" value="Service Summary">';
            xml +='</meta>'
            xml += '</head>';

            xml += '<body padding="0.2in 0.2in 0.2in 0.2in"  size="Letter">';
            xml += '<p>hello world</p>'
            // xml += '<table style="width:100%"><tr><td><b>Date</b></td><td><b>Order Type</b></td><td><b>Order No.</b></td><td><b>Balance</b></td><td><b>Running Sum</b></td><td><b>Ave Weekly</b></td><td><b>In Transit</b></td></tr></table>'
            xml += '</body>';
            xml += '</pdf>';
            //
            //
            // var pdfFile = render.xmlToPdf({
            //
            //     xmlString: xml
            //
            // });
            // // pdfFile.name = 'rawMaterials-'+today+'.pdf';
            //
            //
            //
            // scriptContext.response.write({output: pdfFile})
            // var allDatasets = dataset.list();
            // log.debug({
            //     title: 'All datasets:',
            //     details: allDatasets
            // });

          //  Load the first dataset
          //   var myFirstDataset = dataset.load({
          //       id: 'custdataset_ar_customer_dataset'
          //   });
          //    log.debug('myFirstDataset:', myFirstDataset);
            var renderer=render.create();


            renderer.templateContent=xml;


            var newfile=renderer.renderAsPdf();


            scriptContext.response.writeFile(newfile, true);
            // scriptContext.response.write({ output: html });

        }

        return {onRequest}

    });
