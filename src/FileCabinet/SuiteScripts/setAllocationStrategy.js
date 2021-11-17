function setAllocationStrategy(){
	var soid = nlapiGetRecordId();
  	var soRec = nlapiLoadRecord('transaction',soid);
  for (var i=1; i<=nlapiGetLineItemCount('item'); i++){
  soRec.setLineItemValue('item','orderallocationstrategy',i,3);
	}
  nlapiSubmitRecord(soRec);
}