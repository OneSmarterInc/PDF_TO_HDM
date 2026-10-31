import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import {buildReadableExportData} from '../excel-data.mjs';
const [input,output,previewDir]=process.argv.slice(2);
if(previewDir){
 // Preserve the optional developer-only raster preview command on its original runtime.
 await import('./build-artifact.mjs');
}else{
 const doc=JSON.parse(await fs.readFile(input,'utf8')),wb=new ExcelJS.Workbook();
 for(const data of buildReadableExportData(doc)){
  const sheet=wb.addWorksheet(data.name,{views:[{state:'frozen',ySplit:1}]});
  const widths=data.widths||data.headers.map((title,c)=>Math.min(48,Math.max(12,title.length+2,...data.rows.map(r=>Math.min(48,String(r[c]??'').length+2)))));
  sheet.columns=data.headers.map((title,i)=>({header:title,width:widths[i],style:{numFmt:title.includes('(USD)')?'#,##0.00':/^(?:Page|Source page|Service line|Line number|Part|OCR confidence)/.test(title)?'0':'@'}}));
  // Plain strings are stored as shared text, never interpreted as formulas or links.
  for(const values of data.rows)sheet.addRow(values.map(v=>v===undefined?'':v));
  sheet.eachRow((row,index)=>{row.font={name:'Calibri',size:11,color:{argb:'FF000000'},bold:index===1};row.alignment={vertical:'top',wrapText:true};const values=index===1?data.headers:data.rows[index-2];const lines=Math.max(1,...values.map((v,c)=>String(v??'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/(widths[c]-2))),0)));row.height=index===1?32:Math.min(409,Math.max(20,lines*16));});
  for(const index of data.currencyRows||[])sheet.getCell(index+2,data.currencyColumn+1).numFmt='#,##0.00';
 }
 await wb.xlsx.writeFile(output);
}
