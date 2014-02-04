var rtltr = require("./index.js");

var s1 = ".my-right-class,\
.another-left-class {\
  border-right: 10px;\
  position: absolute;\
  left: 20px;\
  right: 10px;\
  padding: 0 10px 0 0;\
  margin: 0 0 20px 0;\
  float: right;\
  clear: left;\
  text-align: right;\
}";

var s2 = ".my-right-class,\
.another-left-class {\
  border-left: 10px;\
  position: absolute;\
  right: 20px;\
  left: 10px;\
  padding: 0 0 0 10px;\
  margin: 0 0 20px 0;\
  float: left;\
  clear: right;\
  text-align: left;\
}";

if(rtltr.flip(s1) !== s2) {
  console.error("test failure");
  process.exit(1);
}

process.exit(0);
