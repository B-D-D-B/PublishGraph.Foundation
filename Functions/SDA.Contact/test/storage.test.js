'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TableClient}=require('@azure/data-tables'),{reserve}=require('../src/dependencies');
const {createHandler}=require('../src/handler');
test('real Azurite independent clients conditional insert, exact ETag and UTC boundary',async()=>{
  const table='contact'+Date.now(),connection='UseDevelopmentStorage=true';
  const a=TableClient.fromConnectionString(connection,table,{retryOptions:{maxRetries:0}}),b=TableClient.fromConnectionString(connection,table,{retryOptions:{maxRetries:0}});await a.createTable();
  try{const date=new Date('2026-11-18T23:59:59Z');const initial=await Promise.allSettled([reserve(a,date),reserve(b,date)]);assert.equal(initial.filter(r=>r.status==='fulfilled'&&r.value).length,2);let entity=await a.getEntity('contact','2026-11-18');assert.equal(entity.count,2);
    const stale=entity.etag;await a.updateEntity({...entity,count:49},'Replace',{etag:stale});await assert.rejects(b.updateEntity({...entity,count:48},'Replace',{etag:stale}),e=>e.statusCode===412);
    let sends=0;
    const handlers=[a,b].map(client=>createHandler({enabled:true,from:'synthetic@example.com',origins:['https://local.example']},{verify:async()=>true,reserve:()=>reserve(client,date),send:async()=>{sends++;return 'accepted';}}));
    const request=()=>new Request('http://local/api/contact',{method:'POST',headers:{origin:'https://local.example','content-type':'application/json'},body:JSON.stringify({firstName:'Synthetic',lastName:'Test',email:'synthetic@example.com',subjects:['other'],message:'Local only',challengeToken:'mock'})});
    const boundary=await Promise.all([handlers[0](request()),handlers[1](request()),handlers[0](request()),handlers[1](request())]);assert.equal(boundary.filter(r=>r.status===202).length,1);assert.equal(sends,1);assert.equal((await a.getEntity('contact','2026-11-18')).count,50);assert.equal(await reserve(b,date),false);
    assert.equal(await reserve(b,new Date('2026-11-19T00:00:00Z')),true);assert.equal((await a.getEntity('contact','2026-11-19')).count,1);
    // Simulated crash after reservation: no provider call and no refund.
    assert.equal(await reserve(a,new Date('2026-11-19T00:00:00Z')),true);assert.equal((await b.getEntity('contact','2026-11-19')).count,2);
    for(const entity of [await a.getEntity('contact','2026-11-18'),await a.getEntity('contact','2026-11-19')])assert.deepEqual(Object.keys(entity).filter(k=>!['etag','timestamp','partitionKey','rowKey','odata.metadata'].includes(k)).sort(),['count','date']);
  }finally{await a.deleteTable();}
});
