# Schema Context

Generated: 2026-07-18T14:24:56.671Z

## Tables

### company_watchlist

- Approximate row count: 1024
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| company_number | text | NO |
| company_name | text | YES |
| signal_type | text | YES |
| signal_date | timestamp with time zone | YES |
| lender_name | text | YES |
| lender_type | text | YES |
| first_seen | timestamp with time zone | YES |
| last_checked | timestamp with time zone | YES |
| escalated | boolean | YES |
| escalated_at | timestamp with time zone | YES |
| days_on_watchlist | double precision | YES |
| opportunity_id | uuid | YES |

Foreign keys:
- opportunity_id -> opportunities(id)

### criteria_brief

- Approximate row count: 2
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| brief_text | text | NO |
| score_threshold | double precision | YES |
| tier_1_cities | ARRAY | YES |
| updated_at | timestamp with time zone | NO |
| updated_by | text | YES |

### digest_runs

- Approximate row count: 0
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| run_date | timestamp with time zone | NO |
| opportunities_included | ARRAY | YES |
| sent_to | ARRAY | YES |
| status | text | YES |
| total_scored | integer | YES |

### enrichment_queue

- Approximate row count: 193
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| opportunity_id | uuid | YES |
| reason | text | YES |
| created_at | timestamp with time zone | NO |
| processed | boolean | NO |

Foreign keys:
- opportunity_id -> opportunities(id)

### land_registry_ownership

- Approximate row count: 1995230
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| title_number | text | YES |
| tenure | text | YES |
| property_address | text | YES |
| district | text | YES |
| county | text | YES |
| region | text | YES |
| postcode | text | YES |
| company_name | text | YES |
| company_registration_number | text | YES |
| proprietorship_category | text | YES |
| price_paid | text | YES |
| date_proprietor_added | text | YES |
| last_updated | date | YES |

### notifications

- Approximate row count: 0
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| opportunity_id | uuid | YES |
| sent_at | timestamp with time zone | NO |
| sent_to | text | YES |
| notification_type | text | YES |
| status | text | YES |

Foreign keys:
- opportunity_id -> opportunities(id)

### opportunities

- Approximate row count: 2393
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| source | text | YES |
| company_name | text | YES |
| company_number | text | YES |
| signal_type | text | YES |
| city | text | YES |
| city_priority | text | YES |
| address | text | YES |
| date_detected | timestamp with time zone | NO |
| raw_data | jsonb | YES |
| scored | boolean | NO |
| score | double precision | YES |
| rationale | text | YES |
| priority | text | YES |
| sector | text | YES |
| asset_type | text | YES |
| recommended_action | text | YES |
| date_of_signal | timestamp with time zone | YES |
| owned_properties | jsonb | YES |
| owns_property | boolean | YES |
| related_companies | jsonb | YES |
| trading_address | text | YES |
| trading_address_source | text | YES |
| confidence | double precision | YES |
| score_metadata | jsonb | YES |
| has_bank_first_charge | boolean | YES |
| days_on_watchlist_before_stage2 | double precision | YES |
| lender_name | text | YES |
| lender_type | text | YES |
| voa_property_type | text | YES |
| floor_area_sqm | double precision | YES |
| rateable_value_gbp | double precision | YES |

### voa_properties

- Approximate row count: 1571777
- Primary key: (id)

| Column | Type | Nullable |
|---|---|---|
| id | uuid | NO |
| property_reference | text | YES |
| uarn | text | YES |
| full_address | text | YES |
| postcode | text | YES |
| local_authority | text | YES |
| property_type | text | YES |
| voa_property_type | text | YES |
| scat_code | text | YES |
| floor_area_sqm | double precision | YES |
| rateable_value_gbp | double precision | YES |
| effective_date | date | YES |
| last_updated | date | YES |

## Column value reference

Distinct values for low-cardinality columns, top values for high-cardinality ones, and date ranges:

- company_watchlist.signal_type (all values): "confirmation_statement_overdue", "overdue_accounts", "director_resignation", "bridge_charge"
- company_watchlist.signal_date: ranges 2026-01-18 00:00:00+00 .. 2026-07-17 00:00:00+00
- company_watchlist.lender_type (all values): "bridge"
- company_watchlist.first_seen: ranges 2026-07-02 20:44:27.04918+00 .. 2026-07-18 05:33:51.21634+00
- company_watchlist.last_checked: ranges 2026-07-02 21:19:42.316797+00 .. 2026-07-18 05:38:20.939193+00
- company_watchlist.escalated (all values): "true", "false"
- company_watchlist.escalated_at: ranges 2026-07-02 21:19:42.316797+00 .. 2026-07-18 05:38:20.939193+00
- criteria_brief.updated_at: ranges 2026-07-01 22:10:48.101681+00 .. 2026-07-18 13:02:16.513027+00
- enrichment_queue.reason (high cardinality; most common): "score 67 at confidence 0.35; missing: Land Registry ownership match, charges register (encumbrance), signal date, title tenure", "score 67 at confidence 0.30; missing: Land Registry ownership match, charges register (encumbrance), group structure enrichment, signal date", "score 60 at confidence 0.35; missing: Land Registry ownership match, charges register (encumbrance), city, title tenure", "score 67 at confidence 0.50; missing: Land Registry ownership match, charges register (encumbrance), city, title tenure", "score 63 at confidence 0.20; missing: Land Registry ownership match, charges register (encumbrance), city, group structure enrichment", "score 63 at confidence 0.45; missing: Land Registry ownership match, charges register (encumbrance), title tenure, verified trading address", "score 69 at confidence 0.50; missing: Land Registry ownership match, charges register (encumbrance), city, title tenure", "score 61 at confidence 0.30; missing: Land Registry ownership match, charges register (encumbrance), city, sector", "score 62 at confidence 0.45; missing: Land Registry ownership match, charges register (encumbrance), title tenure, verified trading address", "score 71 at confidence 0.55; missing: Land Registry ownership match, charges register (encumbrance), sector, title tenure", ...
- enrichment_queue.created_at: ranges 2026-07-02 21:50:38.620786+00 .. 2026-07-18 05:59:33.053685+00
- enrichment_queue.processed (all values): "false"
- land_registry_ownership.tenure (all values): "Freehold"
- land_registry_ownership.district (high cardinality; most common): "NORTH YORKSHIRE", "BIRMINGHAM", "CORNWALL", "LEEDS", "COUNTY DURHAM", "SOMERSET", "LIVERPOOL", "CHESHIRE EAST", "MANCHESTER", "WIGAN", ...
- land_registry_ownership.county (high cardinality; most common): "GREATER LONDON", "GREATER MANCHESTER", "WEST MIDLANDS", "WEST YORKSHIRE", "LANCASHIRE", "MERSEYSIDE", "KENT", "SOUTH YORKSHIRE", "ESSEX", "HAMPSHIRE", ...
- land_registry_ownership.region (all values): "SOUTH EAST", "NORTH WEST", "GREATER LONDON", "SOUTH WEST", "WEST MIDLANDS", "YORKS AND HUMBER", "EAST MIDLANDS", "NORTH", "EAST ANGLIA", "WALES"
- land_registry_ownership.proprietorship_category (all values): "Limited Company or Public Limited Company", "Community Benefit Society (Company)", "Community Benefit Society (Corporate Body)", "Corporate Body", "Limited Liability Partnership", "Unlimited Company", "Registered Society (Company)", "Housing Association/Society (Company)", "Co-operative Society (Company)", "Housing Association Community Benefit Society (Company)", "Registered Society (Corporate Body)", "Housing Association/Society (Corporate Body)", "Industrial and Provident Society (Company)", "Housing Association Registered Society (Company)", "Co-operative Society (Corporate Body)", "Housing Association Community Benefit Society (Corporate Body)", "Industrial and Provident Society (Corporate Body)", "Housing Association Co-operative Society (Company)", "Housing Association Registered Society (Corporate Body)", "Housing Association Co-operative Society (Corporate Body)"
- land_registry_ownership.price_paid (high cardinality; most common): "", "250000", "150000", "200000", "100000", "300000", "120000", "125000", "110000", "180000", ...
- land_registry_ownership.date_proprietor_added (high cardinality; most common): "20-08-2015", "18-01-2018", "", "17-04-2012", "21-12-2022", "04-05-2018", "19-12-2016", "21-10-2015", "15-01-2020", "10-09-2012", ...
- land_registry_ownership.last_updated: ranges 2026-07-03 .. 2026-07-03
- opportunities.source (all values): "gazette", "companies_house"
- opportunities.signal_type (all values): "liquidator_appointment", "overdue_accounts", "winding_up_petition", "administration", "winding_up_order", "administrator_appointment", "strike_off_notice", "voluntary_strike_off", "director_resignation"
- opportunities.city (all values): "unknown", "London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Newcastle", "Liverpool", "Bristol"
- opportunities.city_priority (all values): "england_wales", "tier_1", "unknown", "northern_ireland"
- opportunities.date_detected: ranges 2026-07-01 23:38:09.344888+00 .. 2026-07-18 05:55:12.574461+00
- opportunities.scored (all values): "true"
- opportunities.priority (all values): "archive", "watch", "enrich", "immediate"
- opportunities.sector (all values): "hospitality", "food and beverage", "property", "retail", "leisure and fitness", "education", "care", "healthcare", "manufacturing", "funeral services", "security and catering", "construction and food and beverage", "construction", "construction and accommodation", "unknown", "personal services", "construction and leisure", "retail and food and beverage", "logistics and food service"
- opportunities.asset_type (high cardinality; most common): "restaurant unit", "hotel building", "hospitality premises", "retail unit", "commercial property", "commercial premises", "care home", "education premises", "catering facility", "pub premises", ...
- opportunities.recommended_action (high cardinality; most common): "Liquidator appointed — contact the liquidator about asset disposals, including any freehold or leasehold premises.", "Winding-up order made — the Official Receiver is in control; register interest in the company's assets early.", "Winding-up petition by HMRC — unpaid VAT/PAYE, a deeper hole than a trade dispute and unlikely to settle quietly; approach the owner directly before the hearing on 2026-07-15.", "Administrators appointed — contact them early about the business and premises before they are openly marketed.", "Winding-up petition by HMRC — unpaid VAT/PAYE, a deeper hole than a trade dispute and unlikely to settle quietly; approach the owner directly before the hearing on 2026-07-22.", "Winding-up petition by HMRC — unpaid VAT/PAYE, a deeper hole than a trade dispute and unlikely to settle quietly; approach the owner directly before the hearing on 2026-07-29.", "Initiate contact to explore acquisition possibilities.", "Investigate the premises for potential acquisition.", "Investigate the property for acquisition opportunities.", "Investigate the property for acquisition potential.", ...
- opportunities.date_of_signal: ranges 0202-05-15 00:00:00+00 .. 2026-07-21 00:00:00+00
- opportunities.owns_property (all values): "false", "true"
- opportunities.has_bank_first_charge (all values): "false", "true"
- opportunities.voa_property_type (all values): "office"
- voa_properties.local_authority (high cardinality; most common): "Birmingham", "Westminster City", "Leeds", "Manchester", "Cornwall", "Bradford", "Liverpool", "Camden", "City Of London", "Sheffield", ...
- voa_properties.property_type (high cardinality; most common): "SHOP AND PREMISES", "OFFICES AND PREMISES", "WORKSHOP AND PREMISES", "WAREHOUSE AND PREMISES", "STORE AND PREMISES", "PUBLIC HOUSE AND PREMISES", "RESTAURANT AND PREMISES", "FACTORY AND PREMISES", "LAND USED FOR STORAGE AND PREMISES", "OFFICE AND PREMISES", ...
- voa_properties.voa_property_type (all values): "industrial", "retail", "office", "restaurant", "pub", "hotel", "leisure", "gym", "cinema", "care_home"
- voa_properties.effective_date: ranges 2026-04-01 .. 2026-06-02
- voa_properties.last_updated: ranges 2026-07-03 .. 2026-07-03
