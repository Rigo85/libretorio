import {filters,terms,fold,searchQuery,encodeCursor,decodeCursor} from '../src/services/CatalogueSearch';
import {describe,test,expect} from '@jest/globals';
import {createHash} from 'crypto';
describe('catalogue search boundaries',()=>{
 test('terms, phrases, accents and enye',()=>{
  expect(terms('Asimov "edad de oro" 2')).toEqual(['asimov','edad de oro','2']);
  expect(fold('  ÁRBOL  NIÑO ')).toBe('arbol niño');expect(fold('NIÑO')).not.toBe(fold('nino'));
  expect(()=>terms('"unterminated')).toThrow();expect(()=>terms('a '.repeat(13))).toThrow();
 });
 test('rejects arrays, oversized, empty and invalid ISBN',()=>{
  for(const query of [{},{q:['a','b']},{q:'a'.repeat(257)},{sort:'arbitrary',q:'a'},{isbn:'abc'},{folder:'/a/../b'},{subfolders:'2',q:'a'}])expect(()=>filters(query)).toThrow();
 });
 test('keyset cursor bound to filters and stable tie id',()=>{
  const f=filters({q:'Asimov'}),cursor=encodeCursor({key:'1asimov',id:10},f);
  expect(decodeCursor(cursor,f)).toEqual({key:'1asimov',id:10});expect(()=>decodeCursor(cursor,filters({q:'other'}))).toThrow();
  expect(()=>decodeCursor(cursor+'?',f)).toThrow();
 });
 test('legacy cursors survive an absent or empty material filter',()=>{
  const legacy={q:'Asimov',title:'',author:'',isbn:'',description:'',language:'',folder:'',kind:'FILE',sort:'relevance',subfolders:'1'};
  const cursor=Buffer.from(JSON.stringify({v:1,hash:createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),key:'1asimov',id:10})).toString('base64url');
  for(const material of [undefined,''])expect(decodeCursor(cursor,filters({...legacy,material}))).toEqual({key:'1asimov',id:10});
  expect(()=>decodeCursor(cursor,filters({...legacy,material:'epub'}))).toThrow();
 });
 test('material alone is a valid search and cursors cannot cross materials',()=>{
  const f=filters({material:'audio'}),cursor=encodeCursor({key:'audio',id:3},f);
  expect(decodeCursor(cursor,f)).toEqual({key:'audio',id:3});
  expect(()=>decodeCursor(cursor,filters({material:'comic'}))).toThrow();
  for(const material of ['FILE','unknown',[],{},'pdf OR true'])expect(()=>filters({material})).toThrow();
 });
 test.each([
  ['pdf','[.]pdf$',undefined],['epub','[.]epub$','EPUB'],
  ['audio','[.](mp3|wav|m4a|m4b|ogg|flac)$','AUDIOBOOK'],
  ['comic','[.](cbr|cbz|cb7|cbt)$','COMIC-MANGA']
 ])('filters %s in SQL before pagination, without availability checks',(material,extension,directory)=>{
  const query=searchQuery(filters({material}));
  expect(query.values).toContain(extension);
  expect(query.text).toContain(`"fileKind"='FILE' AND name ~*`);
  if(directory)expect(query.values).toContain(directory);
  expect(query.text.indexOf('name ~*')).toBeLessThan(query.text.indexOf('LIMIT 51'));
  expect(query.text).not.toMatch(/ready|audio_metadata|cache_artifact_state|document_conversions/);
  expect(query.text).not.toContain('OFFSET');
 });
 test('explicit legacy kind remains a narrowing filter, not a reclassification',()=>{
  const query=searchQuery(filters({kind:'FILE',material:'epub',folder:'/books/50%_'}));
  expect(query.values).toContain('FILE');expect(query.values).toContain('EPUB');
  expect(query.values).toContain('/books/50\\%\\_/%');
 });
 test.each(['title','added','relevance'])('literal escaping and parameter binding (%s)',sort=>{
  const query=searchQuery(filters({q:"50%_ \\ quote'",sort}),{key:'cursor',id:12});
  expect(query.text).not.toContain("quote'");expect(query.text).not.toContain('OFFSET');expect(query.text).toContain('LIMIT 51');
  expect(query.text).toContain('NOT MATERIALIZED');expect(query.values).toContain('50%_');
  const placeholders=[...query.text.matchAll(/\$(\d+)/g)].map(m=>+m[1]);
  expect(Math.max(...placeholders)).toBe(query.values.length);
  expect(new Set(placeholders).size).toBe(query.values.length);
 });
});
