// Consume field crops as they are produced, using one ordered OCR worker.
export function serialConsumer(consume){
  let tail=Promise.resolve(),failure;
  return {
    push(value){tail=tail.then(async()=>{if(failure)return;try{await consume(value);}catch(e){failure=e;}});},
    async drain(){await tail;if(failure)throw failure;}
  };
}
