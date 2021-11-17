function record_deleter(){
var arr=[17185,16073,17553,16386,17770,17150,17894,16451,17261,17283,17738,16223,17271,16628,17563,16254,17830,16171,16533,16056,17494,17679,17624,17670,16434,16976,17776,16330]

for (var i=0; i<arr.length; i++){
    try{
		nlapiDeleteRecord('plannedstandardcost',arr[i]);
	}
	catch(e){nlapiLogExecution('error',e.getDetails())}
	}
}