// config.js — all tunable rules for the Client Response Time Tracker.
// Everything here is a one-line change. No business logic lives in this file.

export const config = {
  // ---------------------------------------------------------------------------
  // BUSINESS HOURS
  // The response clock only ticks during these hours. A client message sent
  // Friday 5pm that is answered Monday 9am counts as ~0 business minutes late.
  // ---------------------------------------------------------------------------
  timezone: 'America/Bogota',        // IANA tz the team works in
  workingDays: [1, 2, 3, 4, 5],      // 0=Sun ... 6=Sat  (Mon–Fri)
  workStartHour: 9,                  // 09:00 local
  workEndHour: 17,                   // 17:00 local
  holidays: [                        // 'YYYY-MM-DD' dates the clock is paused
    // '2026-07-20',
  ],

  // ---------------------------------------------------------------------------
  // SLA — the headline number
  // % of client messages first answered within this many BUSINESS minutes.
  // ---------------------------------------------------------------------------
  slaBusinessMinutes: 10,

  // ---------------------------------------------------------------------------
  // CLIENT-vs-TEAM DETECTION
  // A user is treated as a CLIENT (external) when ANY of these are true:
  //   - they are a Slack guest (is_restricted or is_ultra_restricted)
  //   - their team_id differs from our workspace (Slack Connect)
  //   - their id/email is in clientOverrides below
  // A user is treated as TEAM when:
  //   - they are a full member of our workspace, OR
  //   - their id/email is in teamOverrides below (wins over guest flag)
  // Bots and apps are always excluded from both sides.
  // ---------------------------------------------------------------------------
  // Use these only for edge cases the auto-detection gets wrong
  // (e.g. a client accidentally added as a full member, or a contractor
  // teammate added as a guest). IDs (U0XXXX) preferred; emails also accepted.
  clientOverrides: [],   // force these users to count as CLIENT

  // INTERNAL STAFF (writers, editors, team leads, account staff). Forced to TEAM
  // by member ID so they are never counted as a client AND their replies still
  // count as responses. Pulled from the Lists tab + Ops Master Writer/Editor
  // columns. (Videographers are in excludeUsers instead — see below.)
  teamOverrides: [
    'U07TXMVM5A8',  // Alejandra
    'U08RS9G27A6',  // Daniel Rodriguez
    'U0899FSA20K',  // Oscar Castañeda
    'U08H77GEU8Z',  // Francys Velasquez
    'U08L56GE7A7',  // Manuel Diaz
    'U08LK0N5BSB',  // Andres Villabrille
    'U088PJ1JBNG',  // Anna Romo
    'U087P740327',  // Daniel Latorre
    'U08ASAYH5U5',  // Juliana
    'U07T78EG74Z',  // Laura Gabelo
    'U05V70DDRNV',  // Julia Kuzminski
    'U094J4ZJ25B',  // Arena Hinojosa
    'U09JE7TL10X',  // Camilo Reina
    'U0B9Q0W3Z6U',  // Luna Garcia
    'U08CTBMJUN4',  // Marcos Sanchez
    'U099GM4PY48',  // Oriana Cardenas
    'U097TGVFSAE',  // Xaver Heidrich
    'U08L0NWDALV',  // Jislany Rojas
    'U09D8TRDJJV',  // Alejandra Soledad Bueno (Ale Sol)
    'U09DK0DHE8P',  // Teddy Schlegel
    'U05M516QZ19',  // Pedro Bertonha Sodré
    'U091ARVH03A',  // José Berni
    'U08RS8KRP7U',  // Luke Dalla Bona
    'U09MYM2FGES',  // German Rojas
    'U09LGE8LHL1',  // Mario Castaño
    'U0AE4QGBTPB',  // Ana Buitrago
    'U0B8VMY7W66',  // Karim Bouchahda
    'U05TJS15V7U',  // Aris
    'U08CT4VPDMG',  // Nicolas Vivas (was a guest -> miscounted as client)
    'U0B481ME03T',  // Sofia Caputo (was a guest -> miscounted as client)
    'U0955Q3ECQP',  // Alexis Bravo
    'U059Q3C2AKC',  // Badrul
    'U065A8KV2JW',  // Cheehan De Leon
    'U08JA45KDTM',  // Coleiv Canlas
    'U042WFT5E4X',  // Franz Fries
    'U04TR2DMXGC',  // Janus Cipriano
    'U0959L9D5ED',  // Keissel Indefenso
    'U09KWQXPWM9',  // Kristian Obsid
    'U08MMKP1W2U',  // Mark Anthony Luz
    'U07SM0ZEGUU',  // Mark Juje Dela Cruz
    'U075307SCMU',  // Patrick Jay Indefenso
    'U08V1PNLGQ2',  // Renz Angelo Corpuz
    'U08HEL5SQ30',  // Roma Aquino
    'U08S5CQDJUQ',  // Torraye Bermudez
    'U050Z1TH537',  // Zephyr Mari Olbes
    'U0440P2K01E',  // Omar (Omar Mo)
    'U0AL8V86JE4',  // Stephanie Stewart
    'U08E2FJRS49',  // Chloe Tang
    'U087V4DJQPQ',  // Mishael
    'U083QL8MMU0',  // Andres Cardona
    'U07KJK1QC2Y',  // Natalia Arizaga
    'U065NH8ABEH',  // Natalia Kuzminski
    'U08RB2UV7K9',  // Juan Maldonado
    'U0B8B5MSPRC',  // Juan Morales (was a guest -> miscounted as client)
    'U095K1HABK5',  // Mar Torres
    'U091ARWK332',  // Samantha Contreras
    'U0AA8FDCN79',  // Samantha Infantino (was a guest -> miscounted as client)
    'U08QSDSSC9Y',  // Tina Tran
    // Added 2026-06-30 — writers/editors from Ops Master Spreadsheet (Alpha–Echo tabs).
    // Most of the writer roster was already above; these were the missing ones.
    'U08HDAMRN2H',  // Gabyy Torres (writer)
    'U09GSEFRSG2',  // Bryan Garcia (editor)
    'U061SAQ0GP4',  // Chris Layug ("Chris L." in sheet) (editor)
    'U0AKEDDHBGC',  // Alexrael Caculitan (editor)
    'U0B8S8P8D0D',  // Alther (editor)
    'U0B309FABLN',  // Hero Liwanag (editor)
    'U0AU9J3T5HA',  // Kiron Mapalad (editor)
    'U0AATM8MT62',  // Lyle Serrano (editor)
    'U0ATWCDH5GT',  // Victoria Baron (writer) — victoriab@nomadscast.com
  ],

  // EXCLUDED USERS (e.g. videographers): their messages are ignored entirely —
  // they neither open a ticket nor count as a response. Reacting is enough; no
  // text reply is expected. Matched by display name, real name, id, or email
  // (case-insensitive). To add/remove someone, edit this list.
  excludeUsers: [
    'Che Pak',
    'George Washington',
    'Noah Godfrey',
    'Trey Black',
    'Greg Ports',
    'Zach Saranthus',
    'Jared Kovacs',
    'Basilio Verduzco',
    'Daval Torres',
    'Tony Ousley',
    'Byron Morris',
    'Cheryl Paz',
    'Logan Reavis',        // NOTE: user said "every other week" — excluded fully for now
    'Craig De Maio',
    'Alexander James',
    'Ray Sarracino',
    'Ray Agosto',
    'Shafer Morales',
    'Victoria Keo',
    'Jazmin Luperena',
    'Spencer Reich',
    'Nicholas Ferrara',
    'Spencer Sowers',
    'Kenzie Greer',
    'Marc Altieri',
    'Rendy Ramos',
    'David Jones',
    'Andrew Ebright',
    'DeJuan Jordan',
    'Billy Dickson',
    'Andrew Greenwell',
    'Brandon Magpantay',
    'Victor Cruz',
    'Abigail Luna',
    'Sean Sundrud',
    'A-Ron Johnson',
    'Yazmin Jarrin',
    'Travis Brogen',
    'Charles Tyree',
    'Ana Caldwell',
    'Michael Dispenza',
    'Brady Prescott',
    'Leslie Kirby',
    'Timothy Bogart',
    'Shane Bozman',
    // Display-name aliases (their Slack name differs from the name given):
    'Noah',          // = Noah Godfrey
    'Alex James',    // = Alexander James
    'DeJuan',        // = DeJuan Jordan
    // Matched by member ID (most reliable):
    'U0A4AB86UJK',   // = Ray Sarracino (videographer, cubaray89@gmail.com)
    'U0BB6F31UAG',   // = Brandon Magpantay (bstunt@gmail.com)
  ],

  // ---------------------------------------------------------------------------
  // CHANNEL SCOPING — which channels are "client channels"
  // 'auto'      : any channel containing >=1 external user (recommended)
  // 'prefix'    : only channels whose name starts with channelPrefix
  // 'allowlist' : only channel IDs/names listed in channelAllowlist
  // ---------------------------------------------------------------------------
  channelScope: 'auto',
  channelPrefix: 'client-',
  channelAllowlist: [],  // e.g. ['C0123ABC', 'terry-cullen-chevy']
  channelDenylist: [],   // always exclude these (internal channels caught by 'auto')

  // ---------------------------------------------------------------------------
  // WHAT COUNTS AS A RESPONSE
  // ---------------------------------------------------------------------------
  // Emoji reactions are tracked as "acknowledgements", never as responses,
  // so nobody can game the metric by reacting fast. A real response is the
  // first text message from a non-client, non-bot human.
  countEmojiAsResponse: false,

  // Exclude UNANSWERED pure acknowledgements / closers ("thanks", "got it",
  // "perfect 👍") from the metric — a reply isn't needed after the request is
  // handled. Only fires when every word is an ack word, so a real short
  // request like "take it down" is never excluded.
  excludeAcknowledgements: true,

  // Client messages shorter than this and never answered are treated as
  // likely FYI/no-action noise and excluded from the SLA denominator.
  // Set to 0 to count every client message. (Belt-and-suspenders; the
  // acknowledgement filter above is the smarter primary rule.)
  ignoreUnansweredShorterThan: 0,   // characters; 0 = disabled

  // Emoji a teammate can add to a client message to mark it "no action needed"
  // and exclude it from the metric entirely.
  noActionEmoji: 'no_action',

  // ---------------------------------------------------------------------------
  // LLM ACCURACY GATE (optional) — see docs/superpowers/specs/2026-06-30-...
  // When on, every NON-answered, NON-no_action client ticket is judged by Claude
  // Haiku: "does this need a team reply?" yes -> counts as a miss, no -> excluded.
  // Replaces the ACK_TOKENS word-list as the authority for unanswered inclusion.
  // Needs ANTHROPIC_API_KEY in the env; if absent, falls back to the word-list.
  // ---------------------------------------------------------------------------
  useLlmClassifier: true,
  llmModel: 'claude-haiku-4-5-20251001',
  llmBatchSize: 20,

  // Burst rescue: an UNANSWERED client message is not counted as a miss if the
  // same client got a reply to another message within this many seconds — i.e.
  // it was part of one burst the team handled (e.g. the client split a thought
  // across a thread and the main channel). Answered tickets are never merged
  // with each other, so a genuinely slow reply is never hidden. 0 disables.
  mergeWindowSeconds: 120,

  // ---------------------------------------------------------------------------
  // REPORTING WINDOW
  // ---------------------------------------------------------------------------
  // How many days of history each run pulls (the "week"). Runs are idempotent:
  // re-running recomputes the window from scratch, so safe to re-run.
  lookbackDays: 7,

  // Week label style for the Sheets output row.
  weekLabelStyle: 'iso',   // 'iso' => 2026-W25 ; 'date' => week-ending YYYY-MM-DD

  // ---------------------------------------------------------------------------
  // ASSIGNED-TEAM MAP (optional) — for the "who SHOULD have answered" cut.
  // Map a channel (id or name) to the team/pod that owns it. Channels not
  // listed are reported under team 'Unassigned'. Safe to leave empty for v1;
  // the "who DID respond" attribution works without it.
  // ---------------------------------------------------------------------------
  channelTeamMap: {
    // 'terry-cullen-chevy': 'Alpha',
    // 'C0123ABC': 'Beta',
  },
};

export default config;
