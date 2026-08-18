# Local Issue Follow-up Fields Visual QA

Date: 2026-08-03

Result: pass for PR 0 design freeze

## Reviewed viewports

| Viewport | Result | Notes |
| --- | --- | --- |
| Desktop 1366 × 900 | Pass | Form grouping, relation card, AI card, and next actions retain hierarchy. |
| Mobile 390 × 844 | Pass | Fields stack to one column, actions remain reachable, and the page has no horizontal overflow. |

## Scene checks

- Create / Self hides redundant requester name and organization fields while keeping the relation choice visible.
- Changing the create relation from Self reveals requester identity fields.
- Edit / Customer shows external name, organization, intake channel, reference, commitment, and follow-up fields.
- Detail keeps relationship and delivery separate from derived AI execution.
- Record progress opens an append-style editor and can update waiting-on plus next follow-up.
- Historical / Unknown does not infer Self and offers one explicit recovery action.
- Validation errors have a summary, field association, recovery copy, and disabled save action.

## Boundary checks

- The existing assignee remains the human owner; the prototype does not add a duplicate owner field.
- AI execution is labeled derived and cannot be manually edited.
- External customers are not represented as internal tenant users.
- Requester relation does not change priority, status, permission, or approval policy.
- Existing article source mode remains separate from intake channel.

## Production notes

- Implement the field group as a reusable component shared by create and detail edit surfaces.
- Progress summary should append an activity-backed record instead of overwriting the previous summary without history.
- Date validation must use the server clock for persistence decisions; client validation is guidance only.
- Focus management and error-summary links must be covered by component tests when moved into the production modal.
