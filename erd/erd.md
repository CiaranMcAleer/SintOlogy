# ERD: OSINT Ontology (Initial Example)

```mermaid
erDiagram
  ORGANISATION {
    string id
    string name
    string type
    string jurisdiction
    date   disbanded_on
  }

  POLITICAL_WING {
    string id
    string organisation_id
    string name
    string ideology
  }

  PERSON {
    string id
    string full_name
    date   date_of_birth
    string nationality
  }

  ACTION {
    string id
    string actor_person_id
    string actor_organisation_id
    string action_type
    datetime occurred_at
    string location
  }

  CAMPAIGN {
    string id
    string name
    string campaign_type
    date   start_date
    date   end_date
    string description
  }

  ROLE {
    string id
    string name
    string description
  }

  SOCIAL_MEDIA_PROFILE {
    string id
    string platform
    string handle
    string person_id
    string organisation_id
  }

  POST {
    string id
    string social_media_profile_id
    datetime posted_at
    string content_hash
    string url
  }

  ORGANISATION ||--o{ POLITICAL_WING : has
  PERSON ||--o{ ORGANISATION : member_of

  PERSON ||--o{ ACTION : performs
  ORGANISATION ||--o{ ACTION : performs

  ORGANISATION ||--o{ CAMPAIGN : runs
  PERSON ||--o{ CAMPAIGN : runs

  CAMPAIGN ||--o{ ACTION : includes

  PERSON ||--o{ SOCIAL_MEDIA_PROFILE : owns
  ORGANISATION ||--o{ SOCIAL_MEDIA_PROFILE : owns

  SOCIAL_MEDIA_PROFILE ||--o{ POST : publishes

  ORGANISATION ||--o{ ORGANISATION : splinters_into
  ORGANISATION ||--o{ ROLE : defines
  PERSON ||--o{ ROLE : holds
```

Notes:
- Membership is modeled as a PERSON -> ORGANISATION relationship, so a person can belong to multiple organisations over time.
- ACTION can be attributed to a PERSON or directly to an ORGANISATION; set one of the actor_* fields.
- SOCIAL_MEDIA_PROFILE can belong to a PERSON or an ORGANISATION; set one of the owner fields.
- CAMPAIGN can be run by an ORGANISATION or PERSON.
- CAMPAIGN is composed of ACTION entries.
- ORGANISATION can splinter into one or more other organisations.
- ROLE is defined by an ORGANISATION and held by MEMBER within that organisation.
