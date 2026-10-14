"""
Seed precise_body_article_consumption from the body article Excel.
Run: python scripts/seed-precise-body-article.py
"""

import os, openpyxl, psycopg2
from decimal import Decimal, InvalidOperation
from dotenv import dotenv_values

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dotenv_values(os.path.join(BASE_DIR, '.env'))

EXCEL = r'C:\Users\Administrator\Downloads\COMPILE SHEET- OF BODY  FAB CONSUMPTION-UPDATED-07.10.2026.xlsx'

WIDTH_COLS = [15,16,17,18,19,42,43,44,46,48,50,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,76,78,82,92,94,96]

# Maps DB column name -> Excel header name
MAIN_MAP = {
    'division':                  'DIVISION',
    'sub_division':              'SUB_DIVISION',
    'major_category':            'MAJOR_CATEGORY',
    'macro_body_description':    'MACRO BODY DESCRIPTION',
    'micro_body_article_number': 'MICRO BODY ARTTICLE NUMBER',  # typo in Excel
    'm_neck_type':               'M_NECK_TYPE',
    'm_neck_style':              'M_NECK_STYLE',
    'm_collar_type':             'M_COLLAR_TYPE',
    'm_collar_style':            'M_COLLAR_STYLE',
    'm_sleeves_main_style':      'M_SLEEVES_MAIN_STYLE',
    'm_sleeve_fold':             'M_SLEEVE_FOLD',
    'm_placket':                 'M_PLACKET',
    'm_blt_type':                'M_BLT_TYPE',
    'm_blt_style':               'M_BLT_STYLE',
    'm_btm_fold':                'M_BTM_FOLD',
    'm_pocket':                  'M_POCKET',
    'm_no_of_pocket':            'M_NO_OF_POCKET',
    'm_extra_pocket':            'M_EXTRA_POCKET',
    'm_length':                  'M_LENGTH',
    'm_fit':                     'M_FIT',
    'body_style':                'BODY STYLE',
    'cutting_value':             'CUTTING_VALUE',
    'stitching_sam':             'STITCHING_SAM',
    'sam_val':                   'SAM_VAL',
    'st_val':                    'ST. VAL',
    'ironing_sam':               'IRONING_SAM',
    'finishing_sam':             'FINISHING_SAM',
    'finishig_cost':             'FINISHIG_COST',
    'total_cmp_cost':            'total CMP COST',
}
# Add width columns
for w in WIDTH_COLS:
    MAIN_MAP[f'width_{w}'] = str(w)

DB_COLS = list(MAIN_MAP.keys())  # ordered list of DB column names

TEXT_COLS = {
    'division', 'sub_division', 'major_category',
    'macro_body_description', 'micro_body_article_number',
    'm_neck_type', 'm_neck_style', 'm_collar_type', 'm_collar_style',
    'm_sleeves_main_style', 'm_sleeve_fold', 'm_placket',
    'm_blt_type', 'm_blt_style', 'm_btm_fold', 'm_pocket',
    'm_no_of_pocket', 'm_extra_pocket', 'm_length', 'm_fit', 'body_style',
}
REQUIRED_TEXT = {'division', 'sub_division', 'major_category', 'macro_body_description', 'micro_body_article_number'}


def to_val(db_col: str, raw):
    if raw is None:
        return '' if db_col in REQUIRED_TEXT else None
    s = str(raw).strip()
    if db_col in TEXT_COLS:
        return '' if db_col in REQUIRED_TEXT and s in ('', '-') else (None if s in ('', '-') else s)
    # numeric
    if s in ('', '-'):
        return None
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        return None


def get_dsn():
    url = env.get('DIRECT_URL') or env.get('DATABASE_URL', '')
    return url.split('?')[0] if '?' in url else url


def main():
    print(f'Loading: {EXCEL}')
    wb = openpyxl.load_workbook(EXCEL, read_only=True, data_only=True)
    ws = wb['Sheet1']

    all_rows = list(ws.iter_rows(values_only=True))
    header = all_rows[3]  # row 4 (0-indexed 3)
    wb.close()

    # Build header → column index map
    col_idx: dict[str, int] = {}
    for i, h in enumerate(header):
        if h is not None:
            col_idx[str(h)] = i

    # Verify all Excel headers we need exist
    for db_col, xlsx_col in MAIN_MAP.items():
        if xlsx_col not in col_idx:
            print(f'  WARNING: Excel column "{xlsx_col}" not found (for {db_col})')

    data_rows = [r for r in all_rows[5:] if r[0] or r[2]]
    print(f'Found {len(data_rows)} data rows')

    dsn = get_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    cur.execute('TRUNCATE TABLE public.precise_body_article_consumption RESTART IDENTITY')
    conn.commit()
    print('Table truncated')

    col_list   = ', '.join(f'"{c}"' for c in DB_COLS) + ', created_at, updated_at'
    placeholders = ', '.join(['%s'] * len(DB_COLS)) + ', NOW(), NOW()'
    INSERT_SQL = f'INSERT INTO public.precise_body_article_consumption ({col_list}) VALUES ({placeholders})'

    BATCH = 200
    inserted = 0
    batch = []

    for row in data_rows:
        def get(xlsx_col):
            i = col_idx.get(xlsx_col)
            return row[i] if i is not None and i < len(row) else None

        record = tuple(to_val(db_col, get(MAIN_MAP[db_col])) for db_col in DB_COLS)
        batch.append(record)

        if len(batch) >= BATCH:
            cur.executemany(INSERT_SQL, batch)
            conn.commit()
            inserted += len(batch)
            print(f'\rInserted {inserted}/{len(data_rows)}', end='', flush=True)
            batch = []

    if batch:
        cur.executemany(INSERT_SQL, batch)
        conn.commit()
        inserted += len(batch)

    print(f'\nDone. {inserted} rows loaded.')
    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
