import {beforeEach,afterEach,test,expect,jest} from '@jest/globals';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {ReadingSource,relative,position} from '../src/services/ReadingSource';
import {preferencePatch} from '../src/controllers/reading';
import {config} from '../src/config/configuration';
const mockQuery=jest.fn<(...args:any[])=>Promise<any>>();
jest.mock('../src/db/PostgresAdapter',()=>({PostgresAdapter:{getInstance:()=>({pool:{query:mockQuery}})}}));
jest.mock('../src/config/configuration',()=>({config:{production:{paths:{booksRoot:'',cache:'',public:''}}}}));
let root:string,book:any;
const service=new ReadingSource();
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'reading-source-'));await fs.ensureDir(path.join(root,'books'));
  Object.assign(config.production.paths,{booksRoot:path.join(root,'books'),cache:path.join(root,'cache'),public:root});
  book={id:1,name:'book.pdf',parentPath:path.join(root,'books'),fileKind:'FILE'};
  await fs.writeFile(path.join(book.parentPath,book.name),'%PDF fixture');mockQuery.mockReset();
});
afterEach(async()=>{await fs.remove(root);});
test('detects same-path replacements without reading the complete book',async()=>{
  const first=await service.resolve(book,'pdf');await fs.writeFile(path.join(book.parentPath,book.name),'%PDF updated fixture');
  expect((await service.resolve(book,'pdf')).revision).not.toBe(first.revision);
});
test('rejects symlink escapes and reports a missing mount as unavailable, not deleted',async()=>{
  await fs.writeFile(path.join(root,'outside.pdf'),'private');await fs.remove(path.join(book.parentPath,book.name));
  await fs.symlink(path.join(root,'outside.pdf'),path.join(book.parentPath,book.name));
  await expect(service.resolve(book,'pdf')).rejects.toMatchObject({code:'OUTSIDE_LIBRARY'});
  await fs.remove(book.parentPath);await expect(service.resolve(book,'pdf')).rejects.toMatchObject({code:'SOURCE_UNAVAILABLE'});
});
test('a playlist addition does not invalidate the current audio track',async()=>{
  book.name='audio';book.fileKind='AUDIOBOOK';await fs.ensureDir(path.join(book.parentPath,book.name));
  await fs.writeFile(path.join(book.parentPath,'audio','first.m4b'),'fixture');
  const first=await service.resolve(book,'audio',{track:'first.m4b'});
  await fs.writeFile(path.join(book.parentPath,'audio','second.m4a'),'other');
  expect((await service.resolve(book,'audio',{track:'first.m4b'})).revision).toBe(first.revision);
  await expect(service.resolve(book,'audio',{track:'../book.pdf'})).rejects.toMatchObject({code:'INVALID_LOCATION'});
});
test.each(['../private','/etc/passwd','a/../b','a\\b','a//b','a/./b',''])('rejects arbitrary source locator %s',value=>expect(()=>relative(value)).toThrow());
test('validates versioned progress and excludes arbitrary fields and device-specific preferences',()=>{
  expect(position('pdf',{version:1,page:5,ratio:.5,mode:'original',text:'not stored'})).toEqual({version:1,page:5,ratio:.5,mode:'original'});
  expect(()=>position('audio',{version:1,track:'book.m4a',seconds:NaN})).toThrow();
  expect(()=>position('epub',{version:1,cfi:'invalid',section:'a.xhtml'})).toThrow();
  expect(()=>preferencePatch({expectedRevision:0,patch:{pdf:{fullWidth:true}}})).toThrow();
  expect(()=>preferencePatch({expectedRevision:0,patch:{audio:{volume:.5}}})).toThrow();
});
