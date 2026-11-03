import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
const before=process.argv[2]||'output/migration-before',after=process.argv[3]||'output/migration-after';
const fixtures=['legacy-A-digital','legacy-B-skew','legacy-blank'];
for(const name of fixtures){
 const a=JSON.parse(await fs.readFile(`${before}/${name}.json`)),b=JSON.parse(await fs.readFile(`${after}/${name}.json`));
 assert.deepEqual(b.pages,a.pages,name+': every page, field, reading, checkbox, and source box must match');
 const check=({checkedAt,...verification})=>verification;
 assert.deepEqual(check(b.verification),check(a.verification),name+': verification must match');
 const read=async folder=>{const book=new ExcelJS.Workbook();await book.xlsx.readFile(`${folder}/${name}.xlsx`);return book.worksheets.map(sheet=>({name:sheet.name,rows:sheet.getSheetValues(),columns:sheet.columns.map(c=>({width:c.width,numFmt:c.numFmt}))}));};
 assert.deepEqual(await read(after),await read(before),name+': workbook contents and column formats must match');
 console.log('PASS exact processing and workbook parity: '+name);
}
