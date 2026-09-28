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
`);return true}
export async function persistLots(lots=[]){if(!dbEnabled())return{enabled:false};const p=getPool();let saved=0,snapshots=0;for(const x of lots){const prev=await p.query('SELECT current_bid FROM auction_lots WHERE id=$1',[x.id]);await p.query(`INSERT INTO auction_lots(id,source,lot_number,title,description,url,current_bid,end_time,time_remaining,image_url,status,first_seen,last_seen,raw)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW()),NOW(),$13)
ON CONFLICT(id) DO UPDATE SET source=EXCLUDED.source,lot_number=EXCLUDED.lot_number,title=EXCLUDED.title,description=EXCLUDED.description,url=EXCLUDED.url,current_bid=EXCLUDED.current_bid,end_time=EXCLUDED.end_time,time_remaining=EXCLUDED.time_remaining,image_url=EXCLUDED.image_url,status=EXCLUDED.status,last_seen=NOW(),raw=EXCLUDED.raw`,[x.id,x.source,x.lotNumber,x.title,x.description,x.url,x.currentBid||0,x.endTime,x.timeRemaining,x.imageUrl,x.status,x.firstSeen||null,JSON.stringify(x)]);saved++;if(!prev.rows.length||Number(prev.rows[0].current_bid)!==Number(x.currentBid||0)){await p.query('INSERT INTO price_snapshots(lot_id,current_bid) VALUES($1,$2)',[x.id,x.currentBid||0]);snapshots++}}return{enabled:true,saved,snapshots}}
export async function persistCandidates(items=[]){if(!dbEnabled())return{enabled:false};const p=getPool();for(const x of items)await p.query(`INSERT INTO review_candidates(lot_id,analysis,research,resale_target,confidence,processing_status,processing_error,processed_at)
VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT(lot_id) DO UPDATE SET analysis=EXCLUDED.analysis,research=EXCLUDED.research,resale_target=EXCLUDED.resale_target,confidence=EXCLUDED.confidence,processing_status=EXCLUDED.processing_status,processing_error=EXCLUDED.processing_error,processed_at=NOW()`,[x.id,JSON.stringify(x.analysis||null),JSON.stringify(x.research||null),x.resaleTarget||null,x.confidence||null,x.processingStatus||null,x.processingError||null]);return{enabled:true,saved:items.length}}
export async function dbScannerState(){if(!dbEnabled())return null;const p=getPool(),lots=await p.query('SELECT id,source,lot_number AS "lotNumber",title,description,url,current_bid::float AS "currentBid",end_time AS "endTime",time_remaining AS "timeRemaining",image_url AS "imageUrl",status,first_seen AS "firstSeen",last_seen AS "lastSeen" FROM auction_lots ORDER BY last_seen DESC LIMIT 500'),counts=await p.query('SELECT (SELECT COUNT(*) FROM auction_lots)::int lots,(SELECT COUNT(*) FROM price_snapshots)::int snapshots,(SELECT COUNT(*) FROM review_candidates)::int candidates');return{lots:lots.rows,counts:counts.rows[0]}}
