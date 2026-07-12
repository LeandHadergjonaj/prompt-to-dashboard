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

