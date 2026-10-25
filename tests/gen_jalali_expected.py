"""Writes expected Solar<->Gregorian pairs (from jdatetime) for tests/jalali.test.js.
Usage: python tests/gen_jalali_expected.py /tmp/jd.json"""
import datetime
import json
import sys

import jdatetime

d = jdatetime.date(1200, 1, 1).togregorian()
end = jdatetime.date(1633, 12, 29).togregorian()
rows = []
while d <= end:
    j = jdatetime.date.fromgregorian(date=d)
    rows.append([d.year, d.month, d.day, j.year, j.month, j.day])
    d += datetime.timedelta(days=1)
json.dump(rows, open(sys.argv[1], "w"))