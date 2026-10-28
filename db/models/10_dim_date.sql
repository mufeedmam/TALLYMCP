drop table if exists dim.dim_date cascade;
create table dim.dim_date as
select
  d::date                                              as date,
  to_char(d, 'YYYYMMDD')::int                          as date_key,
  extract(year  from d)::int                           as year,
  extract(month from d)::int                           as month,
  to_char(d, 'Mon')                                    as month_name,
  extract(quarter from d)::int                         as quarter,
  -- Indian financial year: April → March
  (case when extract(month from d) >= 4
        then extract(year from d) else extract(year from d) - 1 end)::int as fin_year_start,
  (case when extract(month from d) >= 4
        then extract(year from d) else extract(year from d) - 1 end)::int
    || '-' ||
  right((case when extract(month from d) >= 4
        then extract(year from d) + 1 else extract(year from d) end)::text, 2) as fin_year
from generate_series('2015-04-01'::date, '2030-03-31'::date, interval '1 day') g(d);

create unique index dim_date_pk on dim.dim_date(date);
create index dim_date_key on dim.dim_date(date_key);
