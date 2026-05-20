import json
from datetime import datetime, timedelta, timezone

ledger_path = '/Users/drunkktoys/.claude/savings-ledger.jsonl'
eight_hours_ago = datetime.now(timezone.utc) - timedelta(hours=8)

total_deleg = 0.0
total_cache = 0.0
count = 0

try:
    with open(ledger_path, 'r') as f:
        for line in f:
            if not line.strip(): continue
            entry = json.loads(line)
            
            ts_str = entry.get('at') or entry.get('ts')
            if not ts_str: continue
            
            ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            
            if ts >= eight_hours_ago:
                count += 1
                val = entry.get('amount_usd') or entry.get('savings_usd') or 0
                
                kind = entry.get('kind') or entry.get('category')
                if kind == 'delegation':
                    total_deleg += val
                elif kind == 'cache':
                    total_cache += val

    print(f'SAVINGS_8H: count={count}, deleg=${total_deleg:.4f}, cache=${total_cache:.4f}')
except Exception as e:
    print(f'SAVINGS_8H_ERROR: {e}')
