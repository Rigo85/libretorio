import {createHash} from 'crypto';

export class SearchError extends Error {
  constructor(readonly status:number, readonly code:string){super(code);}
}
export const searchFields=['q','title','author','isbn','description','language','folder','kind','sort','subfolders'] as const;
export type SearchFilter=Record<typeof searchFields[number],string>;
export function fold(value:string):string {
  return value.normalize('NFC').toLowerCase().replace(/[áàäâãå]/g,'a').replace(/[éèëê]/g,'e')
    .replace(/[íìïî]/g,'i').replace(/[óòöôõ]/g,'o').replace(/[úùüû]/g,'u').replace(/\s+/g,' ').trim();
}
export function terms(value:string):string[] {
  const result:string[]=[];
  const tokens=value.matchAll(/"([^"\n]+)"|(\S+)/g);
  if((value.match(/"/g)?.length??0)%2)throw new SearchError(400,'UNFINISHED_PHRASE');
  for(const token of tokens){result.push(fold(token[1]??token[2]));}
  if(result.length>12)throw new SearchError(400,'TOO_MANY_TERMS');
  return result;
}
export function filters(query:Record<string,unknown>):SearchFilter {
  const value={} as SearchFilter;
  for(const name of searchFields){
    const raw=query[name]??'';
    if(typeof raw!=='string'||raw.length>(name==='folder'?2048:256)||/[\x00-\x1f]/.test(raw))throw new SearchError(400,'INVALID_SEARCH');
    value[name]=raw.trim().normalize('NFC');
  }
  value.sort=value.sort||'relevance';value.subfolders=value.subfolders||'1';
  if(!['relevance','title','added'].includes(value.sort)||!['0','1'].includes(value.subfolders)||
    !['','FILE','EPUB','AUDIOBOOK','COMIC-MANGA','NONE'].includes(value.kind))throw new SearchError(400,'INVALID_SEARCH');
  if(value.folder && (!value.folder.startsWith('/')||value.folder.split('/').includes('..')))throw new SearchError(400,'INVALID_FOLDER');
  value.folder=value.folder.replace(/\/+$/,'');
  if(value.isbn&&(!/^[0-9Xx -]+$/.test(value.isbn)||!/[0-9]/.test(value.isbn)))throw new SearchError(400,'INVALID_ISBN');
  for(const field of ['q','title','author','description'] as const)terms(value[field]);
  if(!searchFields.some(key=>!['sort','subfolders'].includes(key)&&!!value[key]))throw new SearchError(400,'EMPTY_SEARCH');
  return value;
}
const signature=(filter:SearchFilter)=>createHash('sha256').update(JSON.stringify(filter)).digest('hex');
export function decodeCursor(raw:unknown,filter:SearchFilter):{key:string;id:number}|undefined {
  if(raw===undefined)return undefined;
  try{
    if(typeof raw!=='string'||raw.length>4096||!/^[\w-]+$/.test(raw))throw new Error();
    const value=JSON.parse(Buffer.from(raw,'base64url').toString());
    if(value.v!==1||value.hash!==signature(filter)||!Number.isSafeInteger(value.id)||value.id<=0||
      typeof value.key!=='string'||value.key.length>1024||value.key.includes('\0'))throw new Error();
    return {key:value.key,id:value.id};
  }catch{throw new SearchError(400,'INVALID_CURSOR');}
}
export const encodeCursor=(row:{key:string;id:number},filter:SearchFilter)=>Buffer.from(JSON.stringify({v:1,hash:signature(filter),key:row.key,id:row.id})).toString('base64url');
const literal=(value:string)=>value.replace(/[\\%_]/g,'\\$&');
function pattern(value:string):string {
  const vowels:Record<string,string>={a:'[aáàäâãå]',e:'[eéèëê]',i:'[iíìïî]',o:'[oóòöôõ]',u:'[uúùüû]'};
  return Array.from(fold(value)).map(char=>char===' '?'[[:space:]]+':vowels[char]??char.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
}
// No extension inference or JSON key search. Manual metadata replaces extracted metadata.
const sqlFold=(value:string)=>`regexp_replace(translate(lower(normalize(coalesce(${value},''),NFC)),'áàäâãåéèëêíìïîóòöôõúùüû','aaaaaaeeeeiiiiooooouuuu'),'[[:space:]]+',' ','g')`;
export function searchQuery(filter:SearchFilter,cursor?:{key:string;id:number},previous=false):{text:string;values:any[]} {
  const values:any[]=[];const arg=(value:any)=>{values.push(value);return '$'+values.length;};
  const match=(expression:string,word:string)=>`coalesce(${expression},'') ~* ${arg(pattern(word))}`;
  const where:string[]=[];
  // An indexed superset only: final matching still checks visible fields, never JSON keys.
  const anchor=[filter.q,filter.title,filter.author,filter.description].join(' ').match(/[\p{L}\p{N}]{3,}/gu)?.sort((a,b)=>b.length-a.length)[0];
  if(anchor){const prefilter=arg(pattern(anchor));where.push(`(name ~* ${prefilter} OR "localDetails"::text ~* ${prefilter} OR "webDetails"::text ~* ${prefilter})`);}
  for(const field of ['q','title','author','description'] as const)for(const word of terms(filter[field])) {
    where.push(field==='q'?`(${['title','author','description','isbn','name'].map(key=>match(key,word)).join(' OR ')})`:match(field,word));
  }
  if(filter.isbn)where.push(`regexp_replace(isbn,'[^0-9Xx]','','g') LIKE ${arg('%'+literal(filter.isbn.replace(/[^0-9Xx]/g,''))+'%')}`);
  if(filter.language)where.push(match('language',filter.language));
  if(filter.kind)where.push(`"fileKind"=${arg(filter.kind)}`);
  if(filter.folder){const path=arg(filter.folder);where.push(filter.subfolders==='1'?`("parentPath"=${path} OR "parentPath" LIKE ${arg(literal(filter.folder)+'/%')} ESCAPE E'\\\\')`:`"parentPath"=${path}`);}
  const q=filter.sort==='relevance'?fold(terms(filter.q).join(' ')):'';
  const rank=q?`CASE WHEN ${sqlFold('title')}=${arg(q)} THEN '0' WHEN ${sqlFold('title')} LIKE ${arg(literal(q)+'%')} ESCAPE E'\\\\' THEN '1' WHEN ${match('title',q)} THEN '2' ELSE '3' END`:`'0'`;
  const key=filter.sort==='added'?`to_char("createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')`:filter.sort==='title'?`left(${sqlFold('title')},512)`:`${rank}||left(${sqlFold('title')},512)`;
  const descending=filter.sort==='added',direction=descending!==previous?'DESC':'ASC';
  const seek=cursor?`WHERE (key COLLATE "C",id) ${descending!==previous?'<':'>'} (${arg(cursor.key)} COLLATE "C",${arg(cursor.id)})`:'';
  return {values,text:`WITH fields AS NOT MATERIALIZED (
    SELECT id,name,"parentPath","parentHash","coverId","fileKind","createdAt","customDetails","localDetails","webDetails",
      coalesce(nullif(CASE WHEN "customDetails" THEN "webDetails"->>'title' ELSE coalesce("localDetails"->>'title',"webDetails"->>'title') END,''),name) AS title,
      concat_ws(' ',CASE WHEN NOT coalesce("customDetails",false) THEN "localDetails"->>'author(s)' END,"webDetails"->>'author_name') AS author,
      concat_ws(' ',CASE WHEN NOT coalesce("customDetails",false) THEN coalesce("localDetails"->>'comments',"localDetails"->>'description') END,"webDetails"->>'description') AS description,
      concat_ws(' ',CASE WHEN NOT coalesce("customDetails",false) THEN "localDetails"->>'identifiers' END,"webDetails"->>'isbn') AS isbn,
      concat_ws(' ',CASE WHEN NOT coalesce("customDetails",false) THEN coalesce("localDetails"->>'languages',"localDetails"->>'language') END,"webDetails"->>'language') AS language,
      CASE WHEN "customDetails" THEN coalesce("webDetails"->>'cover_i',"coverId") ELSE "coverId" END AS cover
    FROM archive
  ), ranked AS (SELECT id,${key} AS key FROM fields WHERE ${where.join(' AND ')||'TRUE'}),
  page AS (SELECT id,key FROM ranked ${seek} ORDER BY key COLLATE "C" ${direction},id ${direction} LIMIT 51)
  SELECT page.id,page.key,left(f.title,512) AS title,left(f.author,512) AS author,
    f."customDetails",jsonb_build_object('title',left(f."localDetails"->>'title',512),'author(s)',left(f."localDetails"->>'author(s)',512)) AS "localDetails",
    jsonb_build_object('title',left(f."webDetails"->>'title',512),'author_name',coalesce((SELECT jsonb_agg(left(value,160)) FROM
      (SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(f."webDetails"->'author_name')='array' THEN f."webDetails"->'author_name' ELSE '[]'::jsonb END) LIMIT 16) authors),'[]'::jsonb)) AS "webDetails",
    left(f.name,1024) AS name,left(f."parentPath",2048) AS "parentPath",f."parentHash",f."fileKind",left(f.cover,256) AS cover
  FROM page JOIN fields f ON f.id=page.id ORDER BY page.key COLLATE "C" ${direction},page.id ${direction}`};
}
