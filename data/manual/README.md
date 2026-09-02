# Manual data

Local races have no API. Each election gets a folder:

    data/manual/2027-05-dallas/
      candidates.csv   fullName,officeTitle,districtName,party,websiteUrl,ballotpediaUrl
      sources.csv      candidateFullName,url,kind,publisher,publishedAt

The `manual` ingest adapter reads these. Nothing here is a position. Positions are extracted, reviewed, published.
