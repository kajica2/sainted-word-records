// Testable peak extraction for a stereo two-color waveform.
export function waveformPeaks(buffer,columns=1200) {
  if(!buffer || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels<1 || !Number.isInteger(buffer.length) || buffer.length<1) return [];
  const width=Math.max(1,Math.min(4096,Math.floor(columns)||1200));
  const channels=Math.min(2,buffer.numberOfChannels);
  const result=[];
  for(let ch=0;ch<channels;ch++){
    const samples=buffer.getChannelData(ch);
    const peaks=new Float32Array(width);
    for(let x=0;x<width;x++){
      const start=Math.floor(x*samples.length/width);
      const end=Math.min(samples.length,Math.max(start+1,Math.floor((x+1)*samples.length/width)));
      let peak=0;
      for(let i=start;i<end;i++){
        const v=Math.abs(samples[i]);
        if(Number.isFinite(v)&&v>peak)peak=v;
      }
      peaks[x]=Math.min(1,peak);
    }
    result.push(peaks);
  }
  // Mono: use the same audio for both color lanes.
  if(result.length===1)result.push(result[0]);
  return result;
}
export function playbackPosition(time,duration){
  if(!Number.isFinite(duration)||duration<=0)return 0;
  return Math.max(0,Math.min(1,(Number.isFinite(time)?time:0)/duration));
}
