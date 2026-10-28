-- Group dimension + closure table (flatten the parent hierarchy so
-- "everything under Sundry Debtors" is a join, not recursion at query time).

drop table if exists dim.dim_group cascade;
create table dim.dim_group as
select
  guid                 as group_guid,
  name                 as group_name,
  parent               as parent_name,
  primary_group,
  is_revenue,
  is_deemedpositive,
  affects_gross_profit,
  sort_position
from mst_group;
create unique index dim_group_pk on dim.dim_group(group_name);

drop table if exists dim.dim_group_closure cascade;
create table dim.dim_group_closure as
with recursive c as (
  -- each group is its own ancestor at depth 0
  select name as ancestor_name, name as descendant_name, 0 as depth
  from mst_group
  union all
  -- extend downward: children of the current descendant
  select c.ancestor_name, g.name, c.depth + 1
  from c
  join mst_group g on g.parent = c.descendant_name
)
select ancestor_name, descendant_name, depth from c;

create index dim_group_closure_anc  on dim.dim_group_closure(ancestor_name);
create index dim_group_closure_desc on dim.dim_group_closure(descendant_name);
