# c: Split

The Front and the Back as two panels side by side from 1024 px (stacked below), with the Back's panel waiting, dashed, before the reveal so nothing moves when it shows. The ratings are tiles led by a large Interval, and Undo sits in a line under them that names the Rating it would take back ("Rated la cuenta · Hard"). The sidebar stays from 1024 px; below that the screen takes the whole window, with the tab bar hidden and the ratings docked at the bottom.

States: revealed, math, undone, rate-error, done, nothing

Prototype notes: the Interval previews are made up on the client (the API doesn't answer them yet), Ratings are saved for real, and Undo only steps back on screen (the Review stays saved). Formulas get a tint and an accent underline on hover once revealed, and a click copies them.
