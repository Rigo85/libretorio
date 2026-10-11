import {beforeEach,afterEach,test,expect,jest} from '@jest/globals';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {ReadingSource,position,representation} from '../src/services/ReadingSource';
import {comicReadingPage} from '../src/services/ComicReadingService';
import {ComicCacheReaderService} from '../src/services/ComicCacheReaderService';
import {config} from '../src/config/configuration';
const mockQuery=jest.fn<(...args:any[])=>Promise<any>>();
jest.mock('../src/db/PostgresAdapter',()=>({PostgresAdapter:{getInstance:()=>({pool:{query:mockQuery}})}}));
jest.mock('../src/config/configuration',()=>({config:{production:{paths:{booksRoot:'',cache:'',public:''}}}}));
let root:string,book:any,cache:string,state:any;
const source=new ReadingSource(),image='data:image/png;base64,eA==';
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'comic-reading-'));
  Object.assign(config.production.paths,{booksRoot:path.join(root,'books'),cache:path.join(root,'cache'),public:root});
  book={id:1,name:'book.cbz',parentPath:path.join(root,'books'),fileKind:'FILE',coverId:'00000000-0000-4000-8000-000000000001'};
  cache=path.join(root,'cache',book.coverId);await fs.ensureDir(book.parentPath);await fs.ensureDir(cache);
  await fs.writeFile(path.join(book.parentPath,book.name),'archive fixture');
  state={status:'ready',chunksReady:true,chunkCount:3,totalPages:6,buildOutcome:'partial'};
  await fs.writeJson(path.join(cache,'_scanner_state.json'),state);
  let first=1;for(const [index,length] of [2,1,3].entries()){
    await fs.writeJson(path.join(cache,`${book.coverId}_${index}.cache`),{index,pageIndex:first,currentPagesLength:length,totalPages:6,pages:Array(length).fill(image)});first+=length;
  }
  mockQuery.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM archive')?[book]:[{reader_ready:true,chunk_count:3,updated_at:new Date()}]}));
});
afterEach(async()=>{jest.restoreAllMocks();await fs.remove(root);});
test('comic locator is versioned, zero based and stores no image data',()=>{
  expect(representation('comic')).toBe('comic');
  expect(position('comic',{version:1,page:3,chunk:2,image})).toEqual({version:1,page:3,chunk:2});
  for(const p of [{page:-1,chunk:0},{page:1,chunk:1.5},{page:1,chunk:10000}])expect(()=>position('comic',{version:1,...p})).toThrow();
});
test('restores a variable-sized block directly with a stable revision across blocks',async()=>{
  const context=await source.resolve(book,'comic');
  const read=jest.spyOn(ComicCacheReaderService.getInstance(),'getMorePages');
  const result=await comicReadingPage({archiveId:1,id:book.coverId,index:2,sourceRevision:context.revision});
  expect(result.pages).toMatchObject({index:2,pageIndex:4,currentPagesLength:3,totalPages:6});
  expect(result.sourceRevision).toBe(context.revision);expect(read).toHaveBeenCalledTimes(1);
  expect((await source.resolve(book,'comic',{chunk:2,page:5})).revision).toBe(context.revision);
});
test('checks bounds, archive ownership and cache readiness',async()=>{
  await expect(source.resolve(book,'comic',{chunk:3})).rejects.toMatchObject({code:'COMIC_POSITION_MISSING'});
  await expect(source.resolve(book,'comic',{chunk:0,page:6})).rejects.toMatchObject({code:'COMIC_POSITION_MISSING'});
  await expect(comicReadingPage({archiveId:1,id:'different',index:0})).rejects.toMatchObject({code:'MATERIAL_CHANGED'});
  await fs.writeJson(path.join(cache,'_scanner_state.json'),{...state,status:'building'});
  await expect(source.resolve(book,'comic')).rejects.toMatchObject({code:'COMIC_CACHE_MISSING'});
});
test('regeneration invalidates old bookmarks; changes during a block read are rejected',async()=>{
  const old=await source.resolve(book,'comic');
  await fs.writeJson(path.join(cache,'_scanner_state.json'),{...state,updatedAt:'regenerated'});
  await expect(comicReadingPage({archiveId:1,id:book.coverId,index:0,sourceRevision:old.revision})).rejects.toMatchObject({code:'SOURCE_CHANGED'});
  const original=ComicCacheReaderService.getInstance().getMorePages.bind(ComicCacheReaderService.getInstance());
  jest.spyOn(ComicCacheReaderService.getInstance(),'getMorePages').mockImplementation(async(id,index)=>{
    const result=await original(id,index);await fs.writeJson(path.join(cache,'_scanner_state.json'),{...state,updatedAt:'another build'});return result;
  });
  await expect(comicReadingPage({archiveId:1,id:book.coverId,index:0})).rejects.toMatchObject({code:'SOURCE_CHANGED'});
});
test('legacy cache does not depend on snapshot date and validates block geometry',async()=>{
  await fs.remove(path.join(cache,'_scanner_state.json'));
  expect((await source.resolve(book,'comic')).revision).toBe((await source.resolve(book,'comic')).revision);
  await fs.writeJson(path.join(cache,`${book.coverId}_1.cache`),{index:1,pageIndex:3,currentPagesLength:2,totalPages:6,pages:[image]});
  await expect(comicReadingPage({archiveId:1,id:book.coverId,index:1})).rejects.toMatchObject({code:'COMIC_CACHE_INVALID'});
});
test('folder comics work without requiring an archive extension; other folders do not',async()=>{
  book.name='comic-folder';book.fileKind='COMIC-MANGA';await fs.ensureDir(path.join(book.parentPath,book.name));
  expect((await source.resolve(book,'comic')).comic?.totalPages).toBe(6);
  book.fileKind='EPUB';await expect(source.resolve(book,'comic')).rejects.toMatchObject({code:'INVALID_REPRESENTATION'});
});
test('cache symlink escapes and malformed state are rejected',async()=>{
  const file=path.join(cache,`${book.coverId}_1.cache`);await fs.remove(file);
  await fs.writeFile(path.join(root,'outside'),'private');await fs.symlink(path.join(root,'outside'),file);
  await expect(source.resolve(book,'comic',{chunk:1})).rejects.toMatchObject({code:'OUTSIDE_LIBRARY'});
  await fs.writeFile(path.join(cache,'_scanner_state.json'),'broken');
  await expect(source.resolve(book,'comic')).rejects.toMatchObject({code:'COMIC_CACHE_INVALID'});
});
