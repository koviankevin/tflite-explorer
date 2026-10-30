// Small independent FlexBuffers map encoder for public reference-contract tests.
export function flexScalarFixture(values){
    const keys=Object.keys(values).sort(),bytes=[],starts=[];
    const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);bytes.push(...b);};
    const align=()=>{while(bytes.length%4)bytes.push(0);};
    for(const key of keys){starts.push(bytes.length);bytes.push(...new TextEncoder().encode(key),0);}align();u32(keys.length);const keyVector=bytes.length;
    for(const start of starts)u32(bytes.length-start);align();const keyMeta=bytes.length;u32(keyMeta-keyVector);u32(4);u32(keys.length);const map=bytes.length,tags=[];
    for(const key of keys){const v=values[key],b=new Uint8Array(4),view=new DataView(b.buffer);if(typeof v==='boolean'){view.setUint32(0,v?1:0,true);tags.push(26<<2);}else if(Number.isInteger(v)){view.setInt32(0,v,true);tags.push((1<<2)|2);}else{view.setFloat32(0,v,true);tags.push((3<<2)|2);}bytes.push(...b);}
    bytes.push(...tags);align();u32(bytes.length-map);bytes.push((9<<2)|2,4);return Uint8Array.from(bytes);
}
export const detectionOptions=()=>flexScalarFixture({max_detections:5,max_classes_per_detection:1,num_classes:2,nms_score_threshold:.1,nms_iou_threshold:.5,y_scale:10,x_scale:10,h_scale:5,w_scale:5,use_regular_nms:false});
