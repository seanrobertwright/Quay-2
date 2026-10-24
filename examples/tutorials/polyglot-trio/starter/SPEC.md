# SPEC: csv2json

`src/cli.ts` reads one CSV file and prints it as JSON. These rules are the whole
contract. Nothing else is required, and nothing here may be skipped.

1. **Usage.** Run it as `node src/cli.ts <file.csv>`. With no argument, or with a file that
   can't be read, print `Usage: node src/cli.ts <file.csv>` to stderr and exit 2.
2. **Records.** A record ends at a CRLF or an LF line break. A line break at the very end of
   the file does not start an empty record.
3. **Fields.** Fields are separated by commas. Spaces around a field are kept as part of it.
   An empty field is the empty string.
4. **Quotes.** A field wrapped in double quotes may hold commas, line breaks and `""`, which
   stands for one `"`. A line break inside the quotes is kept as it is in the file, CRLF or
   LF. The wrapping quotes are not part of the value.
5. **BOM.** A UTF-8 byte order mark at the start of the file is dropped.
6. **Objects.** The first record is the header. Each later record becomes an object whose
   keys are the header fields, in order. Every value is a string: nothing is converted to a
   number or a boolean.
7. **Ragged.** When a record's field count differs from the header's, print
   `Line <n>: expected <h> fields, got <k>` to stderr, print nothing to stdout, and exit 1.
   `<n>` is the 1-based line of the file on which that record starts, counting every line
   break, including those inside quotes. `<h>` is the header's field count and `<k>` the
   record's.
8. **Output.** Print a JSON array of the objects, indented two spaces, then one line break.
   Exit 0.

## The sample

`samples/orders.csv` has CRLF line endings, a final CRLF, a quoted field holding a comma, one
holding `""`, one holding a line break, and empty fields. `node src/cli.ts samples/orders.csv`
must print exactly this:

```json
[
  {
    "id": "1001",
    "customer": "Smith, Jane",
    "item": "Notebook",
    "quantity": "2",
    "note": ""
  },
  {
    "id": "1002",
    "customer": "Ali Khan",
    "item": "12\" ruler",
    "quantity": "1",
    "note": "Gift wrap"
  },
  {
    "id": "1003",
    "customer": "Mei Chen",
    "item": "Pens",
    "quantity": "10",
    "note": "Leave at the door,\r\nring twice"
  },
  {
    "id": "1004",
    "customer": "Ola Nordmann",
    "item": "Stapler",
    "quantity": "1",
    "note": ""
  }
]
```
