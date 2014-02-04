A helper for CSS rwriting to turn right-to-left into left-to-right and vice versa


```
var rtltr = require("rtltrtltr");
var cssText = ...;
var flipped = rtltr.flip(cssText);
```

Use this to automate the job of changing directionality in your CSS as part of an automated build process

Use `node test` for the moment to verify the library does what it should be doing. There are very few tests at the moment.