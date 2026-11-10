export const MAX_VIDEO_BYTES=150*1024*1024;
export const VIDEO_STRIP_COUNT=7;
export const DEFAULT_MOTION=.35;
export function validateBackgroundVideo(file){
 if(!file)return {ok:false,error:'Choose a video file.'};
 if(!['video/mp4','video/webm','video/quicktime'].includes(file.type) || !Number.isFinite(file.size) || file.size<1 || file.size>MAX_VIDEO_BYTES)
   return {ok:false,error:'Use MP4, WebM or MOV video up to 150 MB.'};
 return {ok:true};
}
export function videoTimeAtAudio(audioTime,videoDuration){
 if(!Number.isFinite(videoDuration)||videoDuration<=0)return 0;
 const time=Number.isFinite(audioTime)?Math.max(0,audioTime):0;
 return time%videoDuration;
}
export function stripOffsets(count=VIDEO_STRIP_COUNT,motion=DEFAULT_MOTION,time=0,energy=0){
 const n=Math.max(1,Math.min(20,Math.trunc(count)||VIDEO_STRIP_COUNT));
 const strength=Math.max(0,Math.min(1,Number.isFinite(motion)?motion:0));
 const intensity=Math.max(0,Math.min(1,Number.isFinite(energy)?energy:0));
 return Array.from({length:n},(_,i)=>Math.sin((Number.isFinite(time)?time:0)*.37+i*.81)*strength*(.03+.07*intensity));
}
