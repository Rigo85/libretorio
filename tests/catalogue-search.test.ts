import {filters,terms,fold,searchQuery,encodeCursor,decodeCursor} from '../src/services/CatalogueSearch';
import {describe,test,expect} from '@jest/globals';
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
 test.each(['title','added','relevance'])('literal escaping and parameter binding (%s)',sort=>{
  const query=searchQuery(filters({q:"50%_ \\ quote'",sort}),{key:'cursor',id:12});
  expect(query.text).not.toContain("quote'");expect(query.text).not.toContain('OFFSET');expect(query.text).toContain('LIMIT 51');
  expect(query.text).toContain('NOT MATERIALIZED');expect(query.values).toContain('50%_');
  const placeholders=[...query.text.matchAll(/\$(\d+)/g)].map(m=>+m[1]);
  expect(Math.max(...placeholders)).toBe(query.values.length);
  expect(new Set(placeholders).size).toBe(query.values.length);
 });
});
