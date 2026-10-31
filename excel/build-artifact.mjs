import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
import {buildReadableExportData} from '../excel-data.mjs';
const [input,output,previewDir]=process.argv.slice(2);
const doc=JSON.parse(await fs.readFile(input,'utf8'));
const wb=Workbook.create(),tables=buildReadableExportData(doc);
const literal=v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v;
for(const data of tables){
  const sheet=wb.worksheets.add(data.name);sheet.showGridLines=true;
  const matrix=[data.headers,...data.rows].map(row=>row.map(literal));
  const range=sheet.getRangeByIndexes(0,0,matrix.length,data.headers.length);
  range.values=matrix;
  range.format.font={name:'Calibri',size:11,color:'#000000'};
  range.format.rowHeight=20;range.format.verticalAlignment='top';
  const header=sheet.getRangeByIndexes(0,0,1,data.headers.length);
  header.format.font={name:'Calibri',size:11,bold:true,color:'#000000'};
  header.format.wrapText=true;header.format.rowHeight=32;
  sheet.freezePanes.freezeRows(1);
  const widths=data.widths||data.headers.map((title,c)=>Math.min(48,Math.max(12,title.length+2,...data.rows.map(r=>Math.min(48,String(r[c]??'').length+2)))));
  for(let c=0;c<data.headers.length;c++){
    const title=data.headers[c];
    sheet.getRangeByIndexes(0,c,matrix.length,1).format.columnWidth=widths[c];
    const cells=sheet.getRangeByIndexes(1,c,Math.max(data.rows.length,1),1);
    cells.setNumberFormat(title.includes('(USD)')?'#,##0.00':/^(?:Page|Source page|Service line|Line number|Part|OCR confidence)/.test(title)?'0':'@');
    cells.format.wrapText=true;
  }
  for(const row of data.currencyRows||[])sheet.getRangeByIndexes(row+1,data.currencyColumn,1,1).setNumberFormat('#,##0.00');
  data.rows.forEach((row,i)=>{
    const lines=Math.max(1,...row.map((v,c)=>String(v??'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/(widths[c]-2))),0)));
    sheet.getRangeByIndexes(i+1,0,1,data.headers.length).format.rowHeight=Math.min(409,Math.max(20,lines*16));
  });
}
wb.recalculate();
if(previewDir){
  await fs.mkdir(previewDir,{recursive:true});
  for(const table of tables){
    const png=await wb.render({sheetName:table.name,range:table.headers.length===4?'A1:D12':'A1:J8',scale:1,format:'png'});
    await fs.writeFile(path.join(previewDir,table.name+'.png'),new Uint8Array(await png.arrayBuffer()));
  }
}
await (await SpreadsheetFile.exportXlsx(wb)).save(output);
