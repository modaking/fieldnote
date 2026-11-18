// PostgREST may cap a page below the requested size. Only an EMPTY page proves
// completion; advance by the rows actually returned, with a unique tie-breaker.
async function pages(db,table,query,{key='id',order=`${key}.asc`,active=()=>true,maxRows=100000,partial=false}={}){
  if(!/^[a-z_][a-z0-9_]*$/i.test(key))throw new Error('Choose a valid record key.');
  const params=new URLSearchParams(query),rows=[],seen=new Set();
  if(params.has('limit')||params.has('offset'))throw new Error('Complete record reads cannot use a partial page.');
  const ordering=params.get('order')||order;
  params.set('order',ordering.split(',').some(part=>part.split('.')[0]===key)?ordering:`${ordering},${key}.asc`);
  for(let offset=0;;){
    if(!active())throw new Error('Your account or workspace changed. Reopen this view.');
    params.set('limit',String(Math.min(1000,maxRows-rows.length+1)));params.set('offset',String(offset));
    const batch=await db.select(table,params.toString());
    if(!active())throw new Error('Your account or workspace changed. Reopen this view.');
    if(!Array.isArray(batch))throw new Error('The record list could not be loaded completely. Refresh and try again.');
    if(!batch.length)return{rows,complete:true};
    for(const row of batch){if(row[key]!=null){if(seen.has(row[key]))throw new Error('Records changed while loading. Refresh before continuing.');seen.add(row[key]);}}
    if(rows.length+batch.length>maxRows){
      if(!partial)throw new Error('This view is too large to load completely. Narrow the farm or period before continuing.');
      rows.push(...batch.slice(0,maxRows-rows.length));return{rows,complete:false};
    }
    rows.push(...batch);offset+=batch.length;
  }
}
export async function readAll(db,table,query='',options={}){return(await pages(db,table,query,options)).rows;}
export const readForList=(db,table,query='',options={})=>pages(db,table,query,{...options,maxRows:10000,partial:true});
// Only these TABLE-valued, read-only RPCs may be repeated. Scalar JSON and
// mutation RPCs keep their existing one-request contract.
const tableReads=new Set(['fw_operational_workers','fw_operational_projects','fw_list_members','fw_list_invites']);
export function readRpcAll(db,name,args={},query='',options={}){
  if(!tableReads.has(name))throw new Error('This RPC is not a paged record list.');
  return readAll({select:(_table,page)=>db.rpc(name,args,page)},name,query,options);
}

export function calendarMonth(value){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')||value.startsWith('0000'))throw new Error('Choose a valid month before posting or closing.');
  const start=new Date(`${value}-01T12:00:00Z`),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  return{from:`${value}-01`,to:end.toISOString().slice(0,10),label:start.toLocaleDateString('en-KE',{month:'long',year:'numeric',timeZone:'Africa/Nairobi'})};
}
