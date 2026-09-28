import {getAutonomySettings,autonomyStats,recordAutonomyDecision,reserveSpend,hasActiveLotReservation} from './db.js';
const n=v=>Number(v)||0;
export async function evaluateAutonomy(x={}){
 const s=await getAutonomySettings();if(!s)return{allowed:false,reasons:['Database unavailable'],mode:'off'};
 const stats=await autonomyStats(),reasons=[],amount=n(x.proposedMax),landed=n(x.projectedLanded),profit=n(x.projectedProfit),roi=n(x.projectedRoi),confidence=n(x.confidence);
 if(s.emergencyStop)reasons.push('Emergency STOP is active');
 if(!['shadow','assisted'].includes(s.mode))reasons.push('Real-money autonomous execution is locked');
 if(!x.lotId)reasons.push('Missing stable lot ID');
 if(await hasActiveLotReservation(x.lotId))reasons.push('Duplicate active reservation for this lot');
 if(amount<=0)reasons.push('No valid authorised bid ceiling');
 if(amount>s.maxItemSpend)reasons.push('Per-item spend limit exceeded');
 if(stats.daily+amount>s.maxDailySpend)reasons.push('Daily spend limit exceeded');
 if(stats.weekly+amount>s.maxWeeklySpend)reasons.push('Weekly spend limit exceeded');
 if(stats.exposure+landed>s.maxCapitalExposure)reasons.push('Capital exposure limit exceeded');
 if(profit<s.minProfit)reasons.push('Minimum projected profit not met');
 if(roi<s.minRoi)reasons.push('Minimum projected ROI not met');
 if(confidence<s.minConfidence)reasons.push('Confidence threshold not met');
 if(stats.training<s.minTrainingDecisions)reasons.push('Training gate not met');
 const allowed=reasons.length===0,decision={lotId:x.lotId,allowed,mode:s.mode,proposedMax:amount,projectedLanded:landed,projectedProfit:profit,projectedRoi:roi,confidence,reasons,stats,limits:s};
 await recordAutonomyDecision(decision);return decision
}
export async function shadowReserve(x={}){const d=await evaluateAutonomy(x);if(!d.allowed)return d;if(d.mode!=='shadow'&&d.mode!=='assisted')return{...d,allowed:false,reasons:['Execution mode locked']};const id='shadow:'+x.lotId+':'+Date.now();await reserveSpend(id,x.lotId,n(x.projectedLanded)||n(x.proposedMax));return{...d,reservationId:id,shadow:true}}
