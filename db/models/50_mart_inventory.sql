-- Inventory marts. Den Healthcare has real stock (160 items); NAQD had 2 dummies.
--
-- SIGN CONVENTION (verified against the data, same credit-positive basis as ledgers):
--   * mst_stock_item.*_value is NEGATIVE for stock-in-hand (a debit asset in Tally's
--     convention). True positive value = -value.
--   * trn_inventory.quantity is physical: +inward, -outward. Net closing qty is +.
--   * trn_inventory.amount is credit-positive: inward (purchase) negative, outward
--     (sale) positive. So sales value = +amount on outward, purchase cost = -amount
--     on inward. Order/non-accounting vouchers are excluded (as in fact_gl).
--
-- PROFITABILITY per item uses the VALUE-BASED accounting COGS identity:
--   cogs         = opening_value + purchases - closing_value   (what was consumed, in ₹)
--   gross_profit = sales_value - cogs
-- Value-based is the right basis here because quantities mix UOMs (gloves bought in
-- sacks, sold in pieces), which makes any per-UNIT (weighted-average-rate) cost
-- meaningless. This ties to the book P&L in aggregate (≈38% gross margin). It CAN
-- distort an individual item when stock is renamed/transferred between item names
-- (unsold purchases get charged to that item's COGS → an impossible margin); those
-- outliers are flagged `profit_unreliable` so they read as data issues to investigate,
-- not real losses.

-- Index the loader's movement table on item — the per-item drill-down filters on it,
-- and without this the window-function history query scans all of trn_inventory.
-- (Persists across truncate+reload; idempotent.)
create index if not exists trn_inventory_item on public.trn_inventory(item);

drop table if exists mart.mart_inventory_items cascade;
create table mart.mart_inventory_items as
with mov as (
  select
    ti.item,
    sum(case when ti.quantity > 0 then ti.quantity else 0 end)      as inward_qty,
    sum(case when ti.quantity < 0 then -ti.quantity else 0 end)     as outward_qty,
    sum(case when ti.quantity < 0 then ti.amount else 0 end)        as sales_value,     -- outward (credit +)
    sum(case when ti.quantity > 0 then -ti.amount else 0 end)       as purchase_value,  -- inward (flip debit to +)
    max(v.date)                                                     as last_movement_date,
    count(*)                                                        as movement_lines
  from trn_inventory ti
  join trn_voucher v on v.guid = ti.guid
  where v.is_accounting_voucher = 1 or v.is_inventory_voucher = 1
  group by ti.item
),
base as (
  select
    si.name                                          as item,
    nullif(si.parent, '')                            as stock_group,
    nullif(si.category, '')                          as category,
    nullif(si.uom, '')                               as uom,
    round(si.opening_balance, 3)                     as opening_qty,
    round(-si.opening_value, 2)                      as opening_value,
    round(si.closing_balance, 3)                     as qty,
    round(si.closing_rate, 4)                        as rate,
    round(-si.closing_value, 2)                      as stock_value,       -- true positive asset value
    round(coalesce(m.inward_qty, 0), 3)              as inward_qty,
    round(coalesce(m.outward_qty, 0), 3)             as outward_qty,
    round(coalesce(m.sales_value, 0), 2)             as sales_value,
    round(coalesce(m.purchase_value, 0), 2)          as purchase_value,
    m.last_movement_date::text                       as last_movement_date,
    (current_date - m.last_movement_date::date)      as days_since_movement,
    coalesce(m.movement_lines, 0)                    as movement_lines,
    (si.closing_balance < 0)                         as is_negative_stock
  from mst_stock_item si
  left join mov m on m.item = si.name
)
select
  b.*,
  round(b.opening_value + b.purchase_value - b.stock_value, 2)                     as cogs,
  round(b.sales_value - (b.opening_value + b.purchase_value - b.stock_value), 2)   as gross_profit,
  case when b.sales_value <> 0
       then round(100 * (b.sales_value - (b.opening_value + b.purchase_value - b.stock_value)) / b.sales_value, 1)
       else null end                                                              as gross_margin_pct,
  -- A margin outside a plausible band signals a stock rename/transfer artifact,
  -- not a real loss — surfaced so the item-level number isn't taken at face value.
  (b.sales_value <> 0
     and (100 * (b.sales_value - (b.opening_value + b.purchase_value - b.stock_value)) / b.sales_value) not between -20 and 95
  )                                                                                as profit_unreliable
from base b;

create index mart_inv_item  on mart.mart_inventory_items(item);
create index mart_inv_group on mart.mart_inventory_items(stock_group);

-- Rollup by stock group.
drop table if exists mart.mart_inventory_by_group cascade;
create table mart.mart_inventory_by_group as
select
  coalesce(stock_group, '(ungrouped)')             as stock_group,
  count(*)                                         as item_count,
  count(*) filter (where qty <> 0)                 as items_in_stock,
  round(sum(stock_value), 2)                       as stock_value,
  round(sum(sales_value), 2)                       as sales_value,
  round(sum(gross_profit), 2)                      as gross_profit
from mart.mart_inventory_items
group by coalesce(stock_group, '(ungrouped)')
order by stock_value desc;

-- Monthly movement (inward = purchases, outward = sales).
drop table if exists mart.mart_inventory_monthly cascade;
create table mart.mart_inventory_monthly as
select
  to_char(v.date, 'YYYY-MM')                                        as year_month,
  round(sum(case when ti.quantity > 0 then ti.quantity else 0 end), 3)   as inward_qty,
  round(sum(case when ti.quantity < 0 then -ti.quantity else 0 end), 3)  as outward_qty,
  round(sum(case when ti.quantity > 0 then -ti.amount else 0 end), 2)    as purchase_value,
  round(sum(case when ti.quantity < 0 then ti.amount else 0 end), 2)     as sales_value,
  count(*)                                                          as movement_lines
from trn_inventory ti
join trn_voucher v on v.guid = ti.guid
where v.is_accounting_voucher = 1 or v.is_inventory_voucher = 1
group by to_char(v.date, 'YYYY-MM')
order by year_month desc;
