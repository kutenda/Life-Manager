import pg from 'pg';
const {Pool}=pg;
let pool;
export function dbEnabled(){return !!process.env.DATABASE_URL}
function getPool(){if(!pool)pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});return pool}
export async function initDb(){if(!dbEnabled())return false;const p=getPool();await p.query(`
CREATE TABLE IF NOT EXISTS auction_lots (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, lot_number TEXT, title TEXT, description TEXT, url TEXT,
 current_bid NUMERIC NOT NULL DEFAULT 0, end_time TEXT, time_remaining TEXT, image_url TEXT, status TEXT,
 first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), raw JSONB
);
CREATE TABLE IF NOT EXISTS price_snapshots (
 id BIGSERIAL PRIMARY KEY, lot_id TEXT NOT NULL REFERENCES auction_lots(id) ON DELETE CASCADE,
 current_bid NUMERIC NOT NULL, observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_lot_time ON price_snapshots(lot_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS review_candidates (
 lot_id TEXT PRIMARY KEY REFERENCES auction_lots(id) ON DELETE CASCADE, analysis JSONB, research JSONB,
 resale_target NUMERIC, confidence NUMERIC, processing_status TEXT, processing_error TEXT,
 processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decision TEXT NOT NULL DEFAULT 'review'
);
CREATE TABLE IF NOT EXISTS business_records (
 id TEXT PRIMARY KEY, record_type TEXT NOT NULL, lot_id TEXT, status TEXT, data JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_records_type_status ON business_records(record_type,status);
CREATE TABLE IF NOT EXISTS learning_events (
 id BIGSERIAL PRIMARY KEY, event_type TEXT NOT NULL, lot_id TEXT, data JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_events_type_time ON learning_events(event_type,created_at DESC);
CREATE TABLE IF NOT EXISTS autonomy_settings (
 id TEXT PRIMARY KEY DEFAULT 'global', emergency_stop BOOLEAN NOT NULL DEFAULT TRUE,
 mode TEXT NOT NULL DEFAULT 'shadow', max_item_spend NUMERIC NOT NULL DEFAULT 250,
 max_daily_spend NUMERIC NOT NULL DEFAULT 500, max_weekly_spend NUMERIC NOT NULL DEFAULT 1500,
 max_capital_exposure NUMERIC NOT NULL DEFAULT 2000, min_profit NUMERIC NOT NULL DEFAULT 100,
 min_roi NUMERIC NOT NULL DEFAULT 40, min_confidence NUMERIC NOT NULL DEFAULT 85,
 min_training_decisions INTEGER NOT NULL DEFAULT 50, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO autonomy_settings(id) VALUES('global') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS spend_reservations (
 id TEXT PRIMARY KEY, lot_id TEXT NOT NULL, amount NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'reserved',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ, released_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_spend_reservations_status_time ON spend_reservations(status,created_at DESC);
CREATE TABLE IF NOT EXISTS autonomy_decisions (
 id BIGSERIAL PRIMARY KEY, lot_id TEXT, allowed BOOLEAN NOT NULL, mode TEXT NOT NULL,
 proposed_max NUMERIC, projected_landed NUMERIC, projected_profit NUMERIC, projected_roi NUMERIC,
 confidence NUMERIC, reasons JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_autonomy_decisions_time ON autonomy_decisions(created_at DESC);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGSERIAL PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, data JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at DESC);
`);return true}
export async function persistLots(lots=[]){if(!dbEnabled())return{enabled:false};const p=getPool();let saved=0,snapshots=0;for(const x of lots){const prev=await p.query('SELECT current_bid FROM auction_lots WHERE id=$1',[x.id]);await p.query(`INSERT INTO auction_lots(id,source,lot_number,title,description,url,current_bid,end_time,time_remaining,image_url,status,first_seen,last_seen,raw)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW()),NOW(),$13)
ON CONFLICT(id) DO UPDATE SET source=EXCLUDED.source,lot_number=EXCLUDED.lot_number,title=EXCLUDED.title,description=EXCLUDED.description,url=EXCLUDED.url,current_bid=EXCLUDED.current_bid,end_time=EXCLUDED.end_time,time_remaining=EXCLUDED.time_remaining,image_url=EXCLUDED.image_url,status=EXCLUDED.status,last_seen=NOW(),raw=EXCLUDED.raw`,[x.id,x.source,x.lotNumber,x.title,x.description,x.url,x.currentBid||0,x.endTime,x.timeRemaining,x.imageUrl,x.status,x.firstSeen||null,JSON.stringify(x)]);saved++;if(!prev.rows.length||Number(prev.rows[0].current_bid)!==Number(x.currentBid||0)){await p.query('INSERT INTO price_snapshots(lot_id,current_bid) VALUES($1,$2)',[x.id,x.currentBid||0]);snapshots++}}return{enabled:true,saved,snapshots}}
export async function persistCandidates(items=[]){if(!dbEnabled())return{enabled:false};const p=getPool();for(const x of items)await p.query(`INSERT INTO review_candidates(lot_id,analysis,research,resale_target,confidence,processing_status,processing_error,processed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(lot_id) DO UPDATE SET analysis=EXCLUDED.analysis,research=EXCLUDED.research,resale_target=EXCLUDED.resale_target,confidence=EXCLUDED.confidence,processing_status=EXCLUDED.processing_status,processing_error=EXCLUDED.processing_error,processed_at=NOW()`,[x.id,JSON.stringify(x.analysis||null),JSON.stringify(x.research||null),x.resaleTarget||null,x.confidence||null,x.processingStatus||null,x.processingError||null]);return{enabled:true,saved:items.length}}
export async function dbScannerState(){if(!dbEnabled())return null;const p=getPool(),lots=await p.query('SELECT id,source,lot_number AS "lotNumber",title,description,url,current_bid::float AS "currentBid",end_time AS "endTime",time_remaining AS "timeRemaining",image_url AS "imageUrl",status,first_seen AS "firstSeen",last_seen AS "lastSeen" FROM auction_lots ORDER BY last_seen DESC LIMIT 500'),counts=await p.query('SELECT (SELECT COUNT(*) FROM auction_lots)::int lots,(SELECT COUNT(*) FROM price_snapshots)::int snapshots,(SELECT COUNT(*) FROM review_candidates)::int candidates');return{lots:lots.rows,counts:counts.rows[0]}}

export async function upsertBusinessRecord(x={}){if(!dbEnabled())return{enabled:false};if(!x.id||!x.recordType)throw new Error('id and recordType required');const p=getPool();await p.query(`INSERT INTO business_records(id,record_type,lot_id,status,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET record_type=EXCLUDED.record_type,lot_id=EXCLUDED.lot_id,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=NOW()`,[x.id,x.recordType,x.lotId||null,x.status||'active',JSON.stringify(x.data||{})]);await appendAudit('upsert',x.recordType,x.id,{status:x.status||'active'});return{enabled:true,saved:1}}
export async function listBusinessRecords(type){if(!dbEnabled())return[];const p=getPool(),r=await p.query('SELECT id,record_type AS "recordType",lot_id AS "lotId",status,data,created_at AS "createdAt",updated_at AS "updatedAt" FROM business_records WHERE ($1::text IS NULL OR record_type=$1) ORDER BY updated_at DESC LIMIT 1000',[type||null]);return r.rows}
export async function appendLearningEvent(eventType,lotId,data={}){if(!dbEnabled())return{enabled:false};const p=getPool(),r=await p.query('INSERT INTO learning_events(event_type,lot_id,data) VALUES($1,$2,$3) RETURNING id,created_at',[eventType,lotId||null,JSON.stringify(data)]);return{enabled:true,...r.rows[0]}}
export async function appendAudit(action,entityType,entityId,data={}){if(!dbEnabled())return{enabled:false};const p=getPool(),r=await p.query('INSERT INTO audit_log(action,entity_type,entity_id,data) VALUES($1,$2,$3,$4) RETURNING id,created_at',[action,entityType||null,entityId||null,JSON.stringify(data)]);return{enabled:true,...r.rows[0]}}
export async function persistentState(){if(!dbEnabled())return null;const p=getPool(),records=await listBusinessRecords(),counts=await p.query(`SELECT (SELECT COUNT(*) FROM business_records)::int records,(SELECT COUNT(*) FROM learning_events)::int learning,(SELECT COUNT(*) FROM audit_log)::int audit`);return{records,counts:counts.rows[0]}}

export async function getAutonomySettings(){if(!dbEnabled())return null;const p=getPool(),r=await p.query('SELECT id,emergency_stop AS "emergencyStop",mode,max_item_spend::float AS "maxItemSpend",max_daily_spend::float AS "maxDailySpend",max_weekly_spend::float AS "maxWeeklySpend",max_capital_exposure::float AS "maxCapitalExposure",min_profit::float AS "minProfit",min_roi::float AS "minRoi",min_confidence::float AS "minConfidence",min_training_decisions AS "minTrainingDecisions",updated_at AS "updatedAt" FROM autonomy_settings WHERE id=\'global\'');return r.rows[0]}
export async function autonomyStats(){if(!dbEnabled())return null;const p=getPool(),r=await p.query(`SELECT
COALESCE(SUM(amount) FILTER(WHERE status='reserved' AND created_at>=date_trunc('day',NOW())),0)::float daily,
COALESCE(SUM(amount) FILTER(WHERE status='reserved' AND created_at>=date_trunc('week',NOW())),0)::float weekly,
COALESCE(SUM(amount) FILTER(WHERE status='reserved'),0)::float exposure,
(SELECT COUNT(*)::int FROM learning_events) training
FROM spend_reservations`);return r.rows[0]}
export async function recordAutonomyDecision(x){if(!dbEnabled())return{enabled:false};const p=getPool(),r=await p.query(`INSERT INTO autonomy_decisions(lot_id,allowed,mode,proposed_max,projected_landed,projected_profit,projected_roi,confidence,reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,created_at`,[x.lotId||null,!!x.allowed,x.mode||'shadow',x.proposedMax||0,x.projectedLanded||0,x.projectedProfit||0,x.projectedRoi||0,x.confidence||0,JSON.stringify(x.reasons||[])]);await appendAudit('autonomy_decision','lot',x.lotId||null,{decisionId:r.rows[0].id,allowed:!!x.allowed,mode:x.mode||'shadow',reasons:x.reasons||[]});return{enabled:true,...r.rows[0]}}
export async function reserveSpend(id,lotId,amount){if(!dbEnabled())return{enabled:false};const p=getPool();await p.query(`INSERT INTO spend_reservations(id,lot_id,amount,status) VALUES($1,$2,$3,'reserved') ON CONFLICT(id) DO NOTHING`,[id,lotId,amount]);return{enabled:true,reserved:true}}
export async function hasActiveLotReservation(lotId){if(!dbEnabled())return false;const p=getPool(),r=await p.query("SELECT 1 FROM spend_reservations WHERE lot_id=$1 AND status='reserved' LIMIT 1",[lotId]);return!!r.rows.length}
