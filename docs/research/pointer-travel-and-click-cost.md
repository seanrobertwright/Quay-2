# Pointer travel and click cost: what the research says

Research for #608 (parent map #600, "Quay shell redesign"). The map has
already decided on a permanent 48 px module bar on the left screen edge, a
right-hand companion column, and a two-ring pie menu with eight directions on
the first ring, selected by press-drag-release. This note gathers what primary
sources say about pointing cost, pie and marking menus, the Keystroke-Level
Model, the Hick-Hyman law and position stability, and ends with rules the
spec can apply.

## How to read this note

Each source carries one of these labels, so a reader can tell what was read
from what was inferred.

- **Full text.** The paper or page itself was read for this note.
- **Abstract only.** Only the abstract was available. Numbers come from it.
- **Not read.** Known only through another source that describes it. The
  describing source is named.

Sentences that begin with "Inference" are reasoning from the sources toward
Quay. They are not findings of any paper.

## Findings in brief

- A pointing action costs about a second and depends only weakly on distance.
  Removing a whole point-and-click saves far more than shortening one.
- A target on a true screen edge is faster to hit than the same target one
  pixel in. The benefit exists only where the cursor is stopped by the edge,
  so it disappears on a side that borders another monitor.
- Pie menus beat linear menus at eight items because every item is close and
  large. Marks drawn without the menu stay under ten percent error up to
  eight directions and two levels, with a mouse as well as a pen. Beyond that
  they become unreliable even for experts.
- Direction is the reliable dimension of a mark. Length is not. No source read
  here tests a second ring that is chosen by dragging further out.
- The Hick-Hyman law does not say "fewer items is faster". For practised
  users in a stable layout, decision time grows with the logarithm of the item
  count. For unfamiliar or moving items, search time grows linearly.
- Stable positions are the best-supported rule in this whole area. Static
  layouts beat adaptive ones, and marks cannot be learned for items that move.
- Evidence is thin for command palettes, for corners, for mouse-specific
  minimum target sizes, and for the menu display delay.

## Fitts's law

### The model

Fitts's law predicts the time to move to a target from its distance and its
size along the direction of travel. The form used in HCI since MacKenzie's
work is `MT = a + b * log2(A / W + 1)`, where `A` is the distance, `W` the
target width, and `a` and `b` are constants fitted per device
([MacKenzie 2003][mackenzie2003], full text of the chapter page, read through
an automated page summary). The logarithm term is the index of difficulty in
bits. Fitts's own 1954 paper was not read; the formula is taken from
MacKenzie.

Card, Moran and Newell give a fit for the mouse:
`tP = 0.8 + 0.1 * log2(d / s + 0.5)` seconds, with `d` the distance and `s`
the target size. They state that the fastest time by this equation is 0.8 s
and the longest likely time, at `d / s = 128`, is 1.5 s
([Card, Moran and Newell 1980][cmn1980], full text).

MacKenzie's chapter reports mouse throughput of 3.73 bits per second by one
calculation and 5.08 by another for the same data, which corresponds to
roughly 0.2 to 0.27 s per bit. The two sources disagree on the slope by a
factor of two or more, and both are measurements of particular mice.

### Practical consequences

- **Distance and size trade off as a ratio.** Doubling the distance costs the
  same as halving the target width. Both add one bit.
- **The constant dominates.** Inference: by the Card, Moran and Newell fit, a
  48 px target at 1500 px takes about 1.30 s and the same target at 200 px
  about 1.02 s. Cutting the travel by a factor of seven and a half saves
  under 0.3 s, while removing the pointing action saves the whole 1.0 to
  1.3 s plus the click. The absolute values come from an old mouse fit, so
  treat them as relative.
- **Very small targets are worse than the law predicts.** Chapuis and
  Dragicevic confirm "a strong departure from Fitts' Law for small target
  acquisition using a mouse", find that both motor size and visual size are
  limiting, and report that performance degrades exponentially as targets get
  very small ([Chapuis and Dragicevic 2011][chapuis2011], abstract only).

### Screen edges

- Appert, Chapuis and Beaudouin-Lafon studied pointing at targets on screen
  edges. The abstract states that edges help because they stop the cursor so
  that less precise movement is needed, that the gain over regular pointing
  "can be up to 44%", and that movement direction affects performance
  ([Appert et al. 2008][appert2008], abstract only; the full text sits behind
  a bot check and could not be retrieved).
- Farris, Jones and Anders found that edge targets were always acquired
  faster than targets placed one pixel from the edge, with a maximum
  advantage of about 393 ms for target heights of 2.00 cm or more and
  distances of 11.75 cm or more ([Farris et al. 2001][farris2001], not read;
  these figures are the abstract as reported by a search index).
- Yamanaka tested mouse pointing between targets on the same edge. Users
  push the cursor into the edge, and about 3% of cursor movement is spent
  off-screen. Movement time still rose as the target's width along the edge
  shrank and as its depth shrank, and error rate rose as the width along the
  edge shrank. The paper concludes that width and height "should be large as
  space permits" even for edge targets, and it found the top edge fastest of
  the four ([Yamanaka 2018][yamanaka2018], full text).

So an edge target is not infinite. It is unbounded only in the direction
that runs into the edge. Its extent along the edge still sets the difficulty.

### Corners

No primary study of corner targets was read. Yamanaka cites the placement of
frequently used targets "on screen edges or corners" as an existing general
guideline. Inference: a corner is stopped in two directions, so it should be
at least as easy as an edge, but this note has no measured value for it.

### Does the edge still hold for a maximised window on Windows

- A maximised window with the standard frame is positioned so that its
  resize borders hang off the screen and the client area spans the full width
  of the work area ([Chen 2015][chen2015], full text, read through an
  automated page summary). Inference: the leftmost client pixel column of a
  maximised Quay window is the leftmost pixel of the monitor's work area, so
  a module bar drawn from client x = 0 touches the edge, provided the taskbar
  is not docked on that side.
- On a multi-monitor setup the desktop covers the bounding rectangle of all
  monitors ([Microsoft, The Virtual Screen][virtualscreen], full text).
  Inference: an edge shared with another monitor does not stop the cursor,
  so the edge benefit is lost there. The module bar is then an ordinary
  target 48 px deep. The same holds for the companion column on the right.
- Chen's post also notes that the overhanging borders used to show as a
  sliver on the neighbouring monitor.
- Windows 11 has a display setting called "Ease cursor movement between
  displays". Only third-party descriptions of it were found, so this note
  makes no claim about how it changes cursor behaviour at shared edges.

Not confirmed: whether Quay's own window (a Tauri webview, possibly with a
custom title bar) delivers clicks on the first pixel column when maximised.
That is a measurement to make in the running app, not something a paper
answers.

### Minimum target size and icon-only targets

- WCAG 2.2 success criterion 2.5.8 (level AA) requires pointer targets of at
  least 24 by 24 CSS pixels, with exceptions for spacing, inline text and a
  few other cases. Criterion 2.5.5 (level AAA) uses 44 by 44 CSS pixels. The
  understanding document says the research the working group reviewed was
  mostly about touchscreens ([W3C, Understanding SC 2.5.8][wcag258], full
  text, read through an automated page summary).
- Microsoft's Windows guidance sets touch targets at 7.5 mm square, 40 by 40
  pixels at 135 PPI, and advises making frequently pressed targets larger
  than the minimum ([Microsoft, Targeting][mstargeting], full text).
- Neither standard is derived from mouse data. The mouse-specific evidence
  read here is Chapuis and Dragicevic's abstract on targets of a few pixels.
- On icons without labels, Wiedenbeck compared label-only, icon-only and
  icon-with-label buttons for novices. Search-index descriptions say
  label-only and icon-with-label did best at first use and that icon-only was
  significantly worse ([Wiedenbeck 1999][wiedenbeck1999], not read). The
  retention result could not be found. Evidence for practised users is thin.

## Pie and marking menus

### Pie against linear menus

Callahan, Hopkins, Weiser and Shneiderman compared pie and linear pop-up
menus with a mouse ([Callahan et al. 1988][callahan1988], full text).

- The experiment used 33 subjects, 15 menus and exactly eight items per
  menu.
- Seek time differed significantly by menu type in favour of pie menus
  (P < 0.01). The difference in errors was marginal (P = 0.087).
- The often-quoted figure of about 15% faster comes from the pilot study of
  16 subjects, as the paper itself says. The table of means in the main
  experiment is not legible in the scanned copy that was read.
- The stated mechanism is Fitts's law. Every pie item was 10 pixels from the
  start point, against 13 to 200 pixels in the linear menu, and pie target
  regions were two to three times the area of linear ones.
- The authors' own cautions: only eight-item menus were tested, pie menus
  take more screen space, subjects were split on preference, and many found
  it hard to "home in on" an item because of the unusual wedge-shaped
  regions.

### How many items per level

Kurtenbach, Sellen and Buxton tested single-level pie menus of 4, 5, 7, 8,
11 and 12 items, visible and hidden, with a mouse, a stylus and a trackball
([Kurtenbach, Sellen and Buxton 1993][ksb1993], full text).

- Mean response time was 0.98 s with the menu visible and 1.10 s with it
  hidden. Mean error was 1.6% visible, 8.2% hidden without an ink trail and
  9.4% hidden with one.
- Hidden menus matched visible ones at four items. Performance degraded as
  the item count rose, but eight and twelve did not follow the trend: there
  was no response-time difference between seven and eight, and twelve was
  more accurate than eleven. Subjects said the clock face helped.
- The mouse and stylus both outperformed the trackball. Overall there was no
  difference between mouse and stylus, though in the group whose marks left
  an ink trail the stylus was faster than the mouse.

Kurtenbach and Buxton's later guidance is to restrict menus to even numbers
of items, up to twelve ([Kurtenbach and Buxton 1994][kb1994], full text).
Zhao, Agrawala and Hinckley describe eight as the limit of the status quo
and measured 87.1% accuracy for twelve-item direction-only menus against
about 98% for their position-based variants, with a pen
([Zhao, Agrawala and Hinckley 2006][zah2006], full text).

### How many levels

Kurtenbach and Buxton measured marks drawn with no menu shown, on menus of
4, 8 and 12 items at depths one to four, with twelve subjects using both a
pen and a mouse ([Kurtenbach and Buxton 1993][kb1993], full text). Layouts
were compass and clock labels, so that subjects knew them perfectly. That
makes these the limits of expert performance, not typical performance.

- "For either device, error rates were below 10% for up to menus of breadth
  8 and depth 2." Four-item menus stayed under ten percent to depth four.
- With eight or more items at depths greater than two, selection "becomes
  error-prone, even for the expert".
- Response time rose linearly with depth. Averaged over all configurations
  it was 1.69 s with the pen and 2.07 s with the mouse, measured from the
  display of the target, so it includes reading the instruction.
- Performance degraded more quickly with the mouse than the pen as breadth
  and depth grew. Mouse and pen error rates began to differ once breadth
  reached eight. At small breadths and depths the two were about equal.
- Marks made only of on-axis segments (up, down, left, right) were
  significantly faster and more accurate than marks with off-axis segments.
  The authors attribute the poor results at high breadth and depth to
  off-axis items and recommend placing frequently used items on-axis.
- Within the reliable range, breadth and depth trade evenly: 64 items as
  four by four by four are about as fast and as accurate as eight by eight.
- Mixing breadths between levels made no significant difference.
- The acceptable error rate "depends on the consequences of an error, the
  cost of undoing an error or redoing the command, and the attitude of the
  user". A user who cannot afford an error can pop the menu up instead.

The per-cell error values exist only in a figure that did not survive text
extraction, so this note quotes the paper's sentences, not its chart.

### Compound strokes against a series of simple strokes

Zhao and Balakrishnan compared the classic zig-zag compound mark with a
series of straight strokes separated by pen lifts, on four-item and
eight-item menus two and three levels deep, with a pen on a tablet
([Zhao and Balakrishnan 2004][zhao2004], full text).

- Overall accuracy was 93% for simple strokes and 80% for compound marks.
  Simple strokes held about 93% across all four layouts, including eight
  items at three levels.
- For compound marks, on-axis selections were 86.05% accurate against 75.87%
  for off-axis and 77.20% for mixed. Simple strokes showed no such
  difference.
- Total time was 2.92 s against 3.09 s. Deeper menus took longer with both
  techniques.
- Marks are scale invariant: only the changes of direction count, not the
  size of the mark. The paper calls this a key factor in their speed.
- Open issues the authors name: whether a series of strokes is harder to
  remember than one compound shape, and whether repeated pen-down events
  cause more mode errors. The study had no mouse condition.

Zhao, Agrawala and Hinckley add a cost for the second level: a two-level
four-by-four direction menu took about 200 ms longer to draw than a single
stroke into a sixteen-item menu of their design, again with a pen.

### Stroke length

Zhao, Agrawala and Hinckley write that stroke length "is difficult for
people to precisely control because it is neither scale-independent nor
attention-free", and build their variants on position and orientation
instead. This is a design argument in the paper, not an experiment on
length.

### Novice to expert transition

- The drawn movement is the same whether the menu is shown or not, so every
  menu selection rehearses the mark ([Kurtenbach and Buxton 1993][kb1993]).
- In a field study of two users over 8.55 and 10.1 hours of editing with a
  six-item marking menu, a mark was on average 3.5 times faster than a menu
  selection. With the 0.33 s press-and-wait delay subtracted, marks were
  still 4.2 and 3.0 times faster for the two users. One user chose the menu
  for 6.6% of selections and the other for about 45%. Mark use dropped after
  breaks and recovered, and the authors conclude that associations "were
  forgotten when not practiced" and that experts go back to the menu to
  refresh ([Kurtenbach and Buxton 1994][kb1994], full text).
- The same paper says marking menus "are not appropriate when the list of
  items changes dynamically", because users "will never graduate to using
  marks since menu item locations change". It also describes replacing a
  command with its own inverse in the same position after use.
- Bailly, Lecolinet and Nigay had 18 participants learn sixteen commands
  with a mouse. Recall in expert mode was 81% with their radial Flower menu,
  40% with Polygon menus and 35% with a linear menu plus hotkeys. They
  conclude that a gesture that starts at the centre and maps directly to a
  direction is what makes radial menus easy to learn
  ([Bailly et al. 2008][flower2008], full text). The study measured
  deliberate learning over minutes, not implicit learning over weeks.

### Menu display delay

The classic design shows the menu only after about a third of a second, to
encourage marks. Studies from 2020 disagree about whether that helps.

- Henderson, Malacria, Nancel and Lank compared delayed and immediate
  display in controlled experiments and "fail to reveal obvious and
  systematic performance or usability advantages to using delay". Only with
  heavy training and two items was the delayed design about 260 ms faster.
  They also did not find the immediate menu more visually disruptive
  ([Henderson et al. 2020][henderson2020], abstract only).
- Lewis and Vogel varied the delay from 200 ms to 2 s on an eight-item
  marking menu in crowdsourced experiments. Longer delays increased
  successful expert selections but can increase errors, and delays of 200 ms
  "can harm long-term retention" ([Lewis and Vogel 2020][lewis2020],
  abstract only).

### Appearance

Tapia and Kurtenbach describe refinements made while shipping marking menus
in a commercial product: show only the labels instead of a filled pie so the
work underneath stays visible, hide parent menus except for their centre,
and give graphical feedback that supports skill development
([Tapia and Kurtenbach 1995][tapia1995], full text, skimmed). These are
design reports without a controlled experiment.

### What this means for an eight-way two-ring pie

- Inference: eight directions on the first ring is at the tested limit, not
  inside a margin. Kurtenbach and Buxton's mouse users were already worse
  than pen users at breadth eight.
- Inference: Quay's press-drag-release is one continuous gesture, so the
  compound-mark results apply to it, not the better multi-stroke results.
- Inference: the evidence covers a second level that is a second choice of
  direction made after a turn. If Quay's second ring is reached by turning
  toward one of up to eight directions, the eight-by-two limit applies
  directly. If it is reached by dragging further out along the same
  direction, or by picking among narrow arcs on an outer ring, no source read
  here measures it. Splitting each 45 degree sector into smaller outer arcs
  raises the effective breadth past the eight to twelve range where
  direction-only selection is reliable. This needs a prototype measurement
  with a mouse, sighted and blind.
- Not read: Samp and Decker's work on concentric radial menus (AVI 2010) and
  Bailly's Wave and Wavelet menus bear on ring layouts. Only search-index
  descriptions were found, so nothing is claimed from them.

## Keystroke-Level Model

### Operators and times

The model predicts how long an expert takes to carry out a routine task by a
given method, by adding up operator times
([Card, Moran and Newell 1980][cmn1980], full text). Kieras's later teaching
note updates two values ([Kieras 2001][kieras2001], full text).

| Operator | Meaning | Time |
| --- | --- | --- |
| K | Key or button press | 0.08 to 1.20 s by typing skill |
| P | Point with the mouse | 1.10 s (0.8 to 1.5 s) |
| H | Home hand between devices | 0.40 s |
| D | Draw n segments of length l cm | 0.9 n + 0.16 l s |
| M | Mental preparation | 1.35 s |
| R | System response | measured, counted only if the user waits |

- K is 0.20 s for an average skilled typist (55 wpm) and 0.28 s for an
  average non-secretary typist (40 wpm). Card, Moran and Newell count the
  mouse click after a point as a separate K of 0.2 s.
- Kieras splits the click out: B, a single press or release of the mouse
  button, is 0.1 s, and a click (BB) is 0.2 s. He recommends 0.28 s for K
  for most users and 1.2 s for M.
- P is a constant chosen for simplicity. Both sources say the real time
  follows Fitts's law.
- M is placed by heuristics: one before each command selection, removed when
  the action is fully anticipated by the one before it or belongs to the same
  cognitive unit.

### Using it for click and travel counts

- A click on a visible control that the user has to decide on is
  `M + P + BB`, about 2.65 s with the 1980 values or 2.5 s with Kieras's.
  When the action is anticipated, it is `P + BB`, about 1.3 s.
- Moving a hand from keyboard to mouse or back adds an H of 0.4 s.
- A drag is `P + B + P + B`.
- Inference: the model has no operator for a marking stroke. D is fitted to
  drawing on a grid and is "a very restricted operator" by the authors'
  description. For a pie selection use `B + stroke + B`, with a measured
  stroke time. The values in the sources are 0.2 s for a practised
  single-level mark (Kurtenbach and Buxton 1993, citing their field study)
  and about 0.2 s more for a second level (Zhao, Agrawala and Hinckley
  2006). Both come from small studies with other hardware.
- Inference: for before-and-after counts, write each task as an explicit
  operator sequence, total it with the constant P, then recompute the P
  terms with Fitts's law only where a layout change alters distance or
  target size.

### Known limits

All of these are stated in the 1980 paper.

- The user must be an expert, the task routine, and the method specified in
  detail. Learning, problem solving and method choice are outside the model.
- Execution is assumed error-free. The paper notes that up to a quarter of
  an expert's time can go to correcting errors.
- It predicts execution time only, not the time to decide what to do next.
- Its prediction error is 21% root-mean-square for a single unit task.
  Inference: a before-and-after difference of less than about a fifth on one
  task is inside the model's noise.
- A single M value for all mental acts is a deliberate simplification.
- Inference: the constant P hides exactly the pointer-travel differences the
  map cares about, and the model has nothing to say about a novice searching
  for an icon.

## Hick-Hyman law

The law says that the time to choose among alternatives is linear in the
information content of the choice, `T = a + b * H`. For equally likely
alternatives it grows with the logarithm of their number. This statement of
it is from [Cockburn, Gutwin and Greenberg 2007][cockburn2007] (full text).
The original papers by Hick (1952) and Hyman (1953) were not read.

### Where it applies

- Cockburn, Gutwin and Greenberg model menu selection as a mix of linear
  visual search for items the user does not know and logarithmic Hick-Hyman
  decision time for items the user knows, plus Fitts pointing time. Their
  experiments fit the model well. A recency-based split menu, whose items
  move, was predicted to allow less improvement with practice than a
  frequency-based one (11% against 24%), and the measured values were 12%
  and 25%.
- Sears and Shneiderman reached the same shape earlier: "a logarithmic model
  applies to familiar (high-frequency) items, and a linear model to
  unfamiliar (low-frequency) items"
  ([Sears and Shneiderman 1994][sears1994], full text of the abstract and
  introduction).

### Where it does not

Liu, Gori, Rioul, Beaudouin-Lafon and Guiard reviewed the choice-reaction
literature and argue the following ([Liu et al. 2020][liu2020], abstract
only):

- Hick's law "speaks against, not for, the popular principle that 'less is
  better'".
- Logarithmic growth in timing data is not necessarily Hick's law.
- The stimulus-response setup of the law "is rarely relevant to HCI tasks,
  where choice-reaction time can often be assumed to be constant".
- For design it is more useful to look at visual search and decision making
  directly.

Inference for Quay: with five module icons the decision cost is close to
constant, so the law gives no reason to add or remove a module. For long
lists inside a panel, what matters is whether the user already knows where
the item is. If so, a broad flat list is cheap. If not, cost grows with
length and search or filtering helps.

## Fixed toolbars, menus at the pointer, palettes and stability

### At the pointer against a fixed bar

- Callahan's mechanism applies: a menu that opens under the pointer puts
  every item a short, equal distance away.
- Kurtenbach and Buxton state the advantage directly: "A mark or selection
  can be made at a user's current location without a trip to a menu bar or
  tool pallet" ([Kurtenbach and Buxton 1993][kb1993]). That sentence is in
  their future-directions section and is not a measured result.
- Odell, Davis, Smith and Wright compared static toolbars, hotkeys, grouped
  hotkeys, marking menus, bimanual marking menus and toolglasses in a shape
  drawing task. Grouped hotkeys and bimanual marking menus were fastest
  ([Odell et al. 2004][odell2004], abstract only, as reported by a search
  index). A later paper is reported to say toolbars were slowest in that
  study; that was not verified.

### Command palettes and shortcuts against visible controls

- No peer-reviewed study comparing a typed command palette with icons or
  menus was found. Evidence here is thin.
- Lane, Napier, Peres and Sandor's paper is titled as a study of the failure
  to move from menus and icon toolbars to keyboard shortcuts
  ([Lane et al. 2005][lane2005], not read).
- Cockburn, Gutwin, Scarr and Malacria's survey states that "many expert
  interface components are seldom used and that there is a tendency for
  users to persistently fail to adopt faster methods"
  ([Cockburn et al. 2014][cockburn2014], abstract only).
- Inference: by the Keystroke-Level Model, a palette command from the mouse
  costs a homing move, a chord, several keystrokes and Enter, with at least
  one M. That is slower than one click on a known visible icon and faster
  than a hunt through an unfamiliar panel. A palette suits the long tail of
  rarely used commands, where recall of a name beats visual search.

### Spatial stability and adaptive content

- Scarr, Cockburn, Gutwin and Bunt built CommandMaps, which show every
  command at once in fixed positions. With experienced users, selections
  were 34% faster than menus and 25% faster than the Ribbon, with one-tenth
  the errors. Novices showed no overall difference. A first study found
  that experienced Word users can point to where familiar commands are with
  the Ribbon hidden ([Scarr et al. 2012][commandmaps2012], full text of the
  introduction and first study).
- Findlater and McGrenere compared static, adaptive and user-adaptable split
  menus with 27 subjects. The static menu was significantly faster than the
  adaptive one, and most subjects preferred the adaptable one
  ([Findlater and McGrenere 2004][findlater2004], full text, skimmed).
- Gajos, Czerwinski, Tan and Weld compared three adaptive toolbars. The one
  that copied likely commands into a separate area and left the rest alone
  improved performance and satisfaction. The one that moved commands did
  not. They attribute the difference to "high spatial stability", and found
  that 70% prediction accuracy gave faster performance than 30%
  ([Gajos et al. 2006][gajos2006], full text).
- Sears and Shneiderman summarise Mitchell and Shneiderman (1989, not read):
  users preferred static menus to ones that reordered by frequency, and on
  first exposure were faster and made fewer errors with static menus.
- Kurtenbach and Buxton's remark that marks cannot be learned for lists that
  change belongs here too.

Inference for a context-dependent pie: the content may differ between a
terminal, a pull request and a ticket, but a given direction should mean the
same family of action everywhere. A command that does not apply should leave
its slot empty or disabled so the others do not shift. No study of
context-dependent marking menus was read, so the second half of that is
reasoning from the stability results.

## Recent work

- [Liu et al. 2020][liu2020] narrows where the Hick-Hyman law can be used.
- [Henderson et al. 2020][henderson2020] and [Lewis and Vogel 2020][lewis2020]
  reopen the question of the marking menu delay, with opposite leanings.
- [Yamanaka 2018][yamanaka2018] refines the edge-target advice.
- WCAG 2.2 added the 24 by 24 minimum target criterion.
- Nothing found from 2020 onward contradicts Fitts's law for mouse pointing,
  the pie-against-linear result, or the eight-by-two limit for marks. The
  search for recent desktop mouse studies of pie or marking menus returned
  only older papers, so recent work may exist that this note missed.

## Rules the spec can apply

Each rule is marked **well-supported** or **tentative**. Tentative means the
source was not read in full, sources conflict, or the rule is an inference.

### Counting cost

- Count each separate point-and-click as about 1.3 s, add 1.2 to 1.35 s when
  the user must decide which command to use, and add 0.4 s for each move of
  a hand between mouse and keyboard. Source: Card, Moran and Newell 1980;
  Kieras 2001. **Well-supported.**
- Remove whole pointing actions before shortening them, because distance
  enters pointing time only through a logarithm. Source: Card, Moran and
  Newell 1980; MacKenzie 2003. **Well-supported.**
- Report every before-and-after figure with its operator sequence and treat
  differences under about a fifth as noise, since the model's error for one
  task is 21%. Source: Card, Moran and Newell 1980. **Well-supported.**
- State that the counts describe a practised, error-free user and say
  nothing about learning. Source: Card, Moran and Newell 1980.
  **Well-supported.**

### Targets and edges

- Put the most-used permanent targets on an outer edge of the desktop and
  let their hit areas run to the last pixel with no gap. Source: Appert et
  al. 2008; Farris et al. 2001; Yamanaka 2018. **Well-supported** for the
  effect; the sizes of the gain come from abstracts.
- Make each module-bar slot as long along the edge as space allows and leave
  no dead space between slots, because extent along the edge still sets time
  and errors. Source: Yamanaka 2018. **Well-supported.**
- Do not count on the edge benefit on a side of the window that borders
  another monitor or when the window is not maximised. Source: inference
  from Appert et al. 2008 and Microsoft's virtual screen description.
  **Tentative.**
- Make no interactive target smaller than 24 by 24 CSS pixels, and make
  frequent ones 40 to 44 or more. Source: WCAG 2.2 SC 2.5.8 and 2.5.5;
  Microsoft Targeting. **Well-supported** as a standard, **tentative** as a
  mouse optimum.
- Give thin controls such as splitters a hit area several times wider than
  their drawn width. Source: Chapuis and Dragicevic 2011. **Tentative**
  (abstract only).
- Show a text label with any icon the user has not yet learned. Source:
  Wiedenbeck 1999. **Tentative** (not read).

### Pie menu

- Use at most eight directions on a ring, and only even counts. Source:
  Kurtenbach, Sellen and Buxton 1993; Kurtenbach and Buxton 1993 and 1994;
  Zhao, Agrawala and Hinckley 2006. **Well-supported.**
- Use at most two levels when a level has eight directions. Source:
  Kurtenbach and Buxton 1993. **Well-supported.**
- Put the most frequent commands on up, down, left and right, and prefer
  second-level choices that are also on-axis. Source: Kurtenbach and Buxton
  1993; Zhao and Balakrishnan 2004. **Well-supported.**
- Select by direction only and never make two commands differ solely by how
  far the pointer is dragged. Source: Zhao, Agrawala and Hinckley 2006; Zhao
  and Balakrishnan 2004 on scale invariance. **Tentative** (a stated design
  principle, no experiment on a distance-selected ring was read).
- Keep the gesture identical with the menu shown and hidden, so that using
  the menu rehearses the mark. Source: Kurtenbach and Buxton 1993 and 1994;
  Bailly et al. 2008. **Well-supported.**
- Keep each direction bound to the same command or command family in every
  context, and at most swap a command for its own inverse in place. Source:
  Kurtenbach and Buxton 1994. **Well-supported.**
- Leave the slot of a command that does not apply empty or disabled instead
  of closing the gap. Source: inference from Kurtenbach and Buxton 1994,
  Findlater and McGrenere 2004 and Gajos et al. 2006. **Tentative.**
- Keep destructive or hard-to-undo commands off marks that can be drawn
  blind, or make them undoable, because expert error approaches ten percent
  at eight by two. Source: Kurtenbach and Buxton 1993. **Well-supported.**
- Treat the menu display delay as a tunable and measure it in Quay. Source:
  Henderson et al. 2020 against Lewis and Vogel 2020. **Tentative**
  (sources conflict).
- Draw labels over the work instead of an opaque disc. Source: Tapia and
  Kurtenbach 1995. **Tentative** (design report, no experiment).

### Menus, lists and stability

- Do not cite Hick's law to justify removing items. Source: Liu et al.
  2020. **Well-supported** (abstract only, but it is the paper's thesis).
- For commands users will learn, prefer one broad, flat, always-in-the-
  same-place surface to nested levels. Source: Scarr et al. 2012; Cockburn
  et al. 2007. **Well-supported.**
- Expect search time proportional to length in any list the user does not
  know or that reorders, and keep such lists short, ordered or filterable.
  Source: Cockburn et al. 2007; Sears and Shneiderman 1994.
  **Well-supported.**
- Fix the position of every permanent control across contexts: module
  icons, panel sections and the companion's actions. Source: Scarr et al.
  2012; Findlater and McGrenere 2004; Cockburn et al. 2007.
  **Well-supported.**
- Put anything adaptive, such as recents or suggestions, in a clearly
  separate area as copies, and leave the stable layout alone. Source: Gajos
  et al. 2006. **Well-supported.**
- Prefer invocation at the pointer for commands that act on the thing under
  the pointer. Source: Callahan et al. 1988; Kurtenbach and Buxton 1993.
  **Well-supported** as a mechanism, **tentative** in size.
- Keep the command palette for the long tail and show each command's
  shortcut beside its visible control, because users rarely switch to a
  faster method unprompted. Source: Cockburn et al. 2014; Lane et al. 2005.
  **Tentative** (no palette study found).

## What could not be confirmed

- The full text of Appert et al. 2008, Henderson et al. 2020, Liu et al.
  2020, Lewis and Vogel 2020, Chapuis and Dragicevic 2011 and Cockburn et al.
  2014. Their abstracts were read.
- Farris et al. 2001, Odell et al. 2004, Wiedenbeck 1999, Lane et al. 2005,
  Mitchell and Shneiderman 1989, Fitts 1954, Hick 1952 and Hyman 1953. They
  are known here only through other sources.
- The numeric means in Callahan et al.'s main experiment and the per-cell
  error rates in Kurtenbach and Buxton 1993, which are in tables or figures
  that were not legible.
- Any measurement of a pie whose second ring is chosen by drag distance.
- Any controlled study of command palettes.
- How Windows treats the cursor at an edge shared by two displays, from
  first-party documentation.
- Whether a maximised Quay window receives clicks on its first pixel column.
- Pages marked "read through an automated page summary" were fetched as web
  pages and condensed by a tool, so a detail could have been lost. The
  papers marked full text without that note were read as extracted text.

## Sources

- [Appert, Chapuis and Beaudouin-Lafon 2008][appert2008]. Evaluation of
  pointing performance on screen edges. AVI 2008.
- [Bailly, Lecolinet and Nigay 2008][flower2008]. Flower menus. AVI 2008.
- [Callahan, Hopkins, Weiser and Shneiderman 1988][callahan1988]. An
  empirical comparison of pie vs. linear menus. CHI 1988.
- [Card, Moran and Newell 1980][cmn1980]. The keystroke-level model for user
  performance time with interactive systems. Communications of the ACM
  23(7).
- [Chapuis and Dragicevic 2011][chapuis2011]. Effects of motor scale, visual
  scale, and quantization on small target acquisition difficulty. ACM TOCHI.
- [Chen 2015][chen2015]. Why are the dimensions of a maximized window larger
  than the monitor? Microsoft, The Old New Thing.
- [Cockburn, Gutwin and Greenberg 2007][cockburn2007]. A predictive model of
  menu performance. CHI 2007.
- [Cockburn, Gutwin, Scarr and Malacria 2014][cockburn2014]. Supporting
  novice to expert transitions in user interfaces. ACM Computing Surveys.
- [Farris, Jones and Anders 2001][farris2001]. Acquisition speed with
  targets on the edge of the screen. Proceedings of the Human Factors and
  Ergonomics Society 45th Annual Meeting. The link is the search-index
  record.
- [Findlater and McGrenere 2004][findlater2004]. A comparison of static,
  adaptive, and adaptable menus. CHI 2004.
- [Gajos, Czerwinski, Tan and Weld 2006][gajos2006]. Exploring the design
  space for adaptive graphical user interfaces. AVI 2006.
- [Henderson, Malacria, Nancel and Lank 2020][henderson2020]. Investigating
  the necessity of delay in marking menu invocation. CHI 2020.
- [Kieras 2001][kieras2001]. Using the Keystroke-Level Model to estimate
  execution times. University of Michigan.
- [Kurtenbach and Buxton 1993][kb1993]. The limits of expert performance
  using hierarchic marking menus. INTERCHI 1993.
- [Kurtenbach and Buxton 1994][kb1994]. User learning and performance with
  marking menus. CHI 1994.
- [Kurtenbach, Sellen and Buxton 1993][ksb1993]. An empirical evaluation of
  some articulatory and cognitive aspects of marking menus. Human-Computer
  Interaction 8(1).
- [Lane, Napier, Peres and Sandor 2005][lane2005]. Hidden costs of graphical
  user interfaces. International Journal of Human-Computer Interaction
  18(2).
- [Lewis and Vogel 2020][lewis2020]. Longer delays in rehearsal-based
  interfaces increase expert use. ACM TOCHI.
- [Liu, Gori, Rioul, Beaudouin-Lafon and Guiard 2020][liu2020]. How relevant
  is Hick's law for HCI? CHI 2020.
- [MacKenzie 2003][mackenzie2003]. Motor behaviour models for human-computer
  interaction. In Carroll (ed.), HCI Models, Theories, and Frameworks.
- [Microsoft, Targeting][mstargeting]. Windows app design guidance.
- [Microsoft, The Virtual Screen][virtualscreen]. Win32 documentation.
- [Odell, Davis, Smith and Wright 2004][odell2004]. Toolglasses, marking
  menus, and hotkeys. Graphics Interface 2004.
- [Scarr, Cockburn, Gutwin and Bunt 2012][commandmaps2012]. Improving
  command selection with CommandMaps. CHI 2012.
- [Sears and Shneiderman 1994][sears1994]. Split menus: effectively using
  selection frequency to organize menus. ACM TOCHI 1(1).
- [Tapia and Kurtenbach 1995][tapia1995]. Some design refinements and
  principles on the appearance and behavior of marking menus. UIST 1995.
- [W3C, Understanding SC 2.5.8][wcag258]. Target Size (Minimum), WCAG 2.2.
- [Wiedenbeck 1999][wiedenbeck1999]. The use of icons and labels in an end
  user application program. Behaviour and Information Technology.
- [Yamanaka 2018][yamanaka2018]. Mouse cursor movements towards targets on
  the same screen edge. Graphics Interface 2018.
- [Zhao, Agrawala and Hinckley 2006][zah2006]. Zone and polygon menus. CHI
  2006.
- [Zhao and Balakrishnan 2004][zhao2004]. Simple vs. compound mark
  hierarchical marking menus. UIST 2004.

[appert2008]: https://doi.org/10.1145/1385569.1385590
[callahan1988]: https://doi.org/10.1145/57167.57182
[chapuis2011]: https://doi.org/10.1145/1993060.1993063
[chen2015]: https://devblogs.microsoft.com/oldnewthing/20150304-00/?p=44543
[cmn1980]: https://iiif.library.cmu.edu/file/Newell_box00072_fld05094_doc0001/Newell_box00072_fld05094_doc0001.pdf
[cockburn2007]: https://doi.org/10.1145/1240624.1240723
[cockburn2014]: https://doi.org/10.1145/2659796
[commandmaps2012]: https://doi.org/10.1145/2207676.2207713
[farris2001]: https://scilit.com/publications/6e8ad8e0ee54fcad47a09acf1f90cbc2
[findlater2004]: https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf
[flower2008]: https://doi.org/10.1145/1385569.1385575
[gajos2006]: https://doi.org/10.1145/1133265.1133306
[henderson2020]: https://doi.org/10.1145/3313831.3376296
[kb1993]: https://www.billbuxton.com/MMExpert.html
[kb1994]: https://www.billbuxton.com/MMUserLearn.html
[kieras2001]: https://web.eecs.umich.edu/~kieras/docs/GOMS/KLM.pdf
[ksb1993]: https://damassets.autodesk.net/content/dam/autodesk/research/publications-assets/pdf/an-empirical-evaluation-of.pdf
[lane2005]: https://doi.org/10.1207/s15327590ijhc1802_1
[lewis2020]: https://doi.org/10.1145/3418196
[liu2020]: https://doi.org/10.1145/3313831.3376878
[mackenzie2003]: https://www.yorku.ca/mack/mackenzie_chapter.html
[mstargeting]: https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-targeting
[odell2004]: https://graphicsinterface.org/proceedings/gi2004/gi2004-3
[sears1994]: https://www.cs.umd.edu/~ben/papers/Sears1994Split.pdf
[tapia1995]: https://doi.org/10.1145/215585.215973
[virtualscreen]: https://learn.microsoft.com/en-us/windows/win32/gdi/the-virtual-screen
[wcag258]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[wiedenbeck1999]: https://doi.org/10.1080/014492999119129
[yamanaka2018]: https://graphicsinterface.org/wp-content/uploads/gi2018-16.pdf
[zah2006]: https://doi.org/10.1145/1124772.1124933
[zhao2004]: https://www.dgp.toronto.edu/~ravin/papers/uist2004_simplemm.pdf
