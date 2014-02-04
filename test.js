var rtltr = require("./index.js");

function test() {
  if (rtltr.flip(s1) !== s2) {
    console.error("no equivalence;", s1, s2);
    process.exit(1);
  }
}


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

test();

s1 = "@keyframes spin {\
  0% {\
    transform: rotate(0deg);\
    left: 0;\
  }\
  100% {\
    transform: rotate(359deg);\
    left: 100%;\
  }\
}\
";

s2 = "@keyframes spin {\
  0% {\
    transform: rotate(0deg);\
    right: 0;\
  }\
  100% {\
    transform: rotate(359deg);\
    right: 100%;\
  }\
}\
";

test();

s1 = ".hero-section .illustration {\
  width: 60%;\
  display: inline-block;\
  margin: 20px 0;\
  position: relative;\
}\
@media (min-width: 1020px) {\
  .hero-section .illustration {\
    margin: 80px 40px 0 0;\
    width: 40%;\
  }\
}\
";

s2 = ".hero-section .illustration {\
  width: 60%;\
  display: inline-block;\
  margin: 20px 0;\
  position: relative;\
}\
@media (min-width: 1020px) {\
  .hero-section .illustration {\
    margin: 80px 0 0 40px;\
    width: 40%;\
  }\
}\
";

test();
