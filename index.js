(function() {
  "use strict";

  var ParseError = function(errorLabel) {
    console.error(errorLabel);
  };
  ParseError.prototype = {};

  function Stream(text) {
    this.text = text;
    this.pos = 0;
    this.tokenStart = 0;
  }

  Stream.prototype = {
    peek: function() {
      return this.text[this.pos];
    },
    substream: function(len) {
      if(len !== undefined) return this.text.substring(this.pos, this.pos + len);
      return this.text.substring(this.pos);
    },
    next: function() {
      if (!this.end())
        return this.text[this.pos++];
    },
    end: function() {
      return (this.pos == this.text.length);
    },
    eat: function(match) {
      if (!this.end() && this.peek().match(match))
        return this.next();
    },
    eatWhile: function(matcher) {
      var wereAnyEaten = false;
      while (!this.end()) {
        if (this.eat(matcher))
          wereAnyEaten = true;
        else
          return wereAnyEaten;
      }
    },
    eatSpace: function() {
      return this.eatWhile(/[\s\n]/);
    },
    eatCSSWhile: function(matcher) {
      var wereAnyEaten = false,
          chr = '',
          peek = '',
          next = '';
      while (!this.end()) {
        chr = this.eat(matcher);
        if (chr)
          wereAnyEaten = true;
        else
          return wereAnyEaten;
        if (chr === '/') {
          peek = this.peek();
          if (peek === '*') {
            /* Block comment found. Gobble until resolved. */
            while(next !== '/' && !this.end()) {
              this.eatWhile(/[^*]/);
              this.next();
              next = this.next();
            }
            next = '';
          }
        }
      }
    },
    markTokenStart: function() {
      this.tokenStart = this.pos;
    },
    markTokenStartAfterSpace: function() {
      this.eatSpace();
      this.markTokenStart();
    },
    makeToken: function() {
      if (this.pos == this.tokenStart)
        return null;
      var token = {
        value: this.text.slice(this.tokenStart, this.pos),
        interval: {
          start: this.tokenStart,
          end: this.pos
        }
      };
      this.tokenStart = this.pos;
      return token;
    },
    match: function(string, consume, caseFold) {
      var substring = this.text.slice(this.pos, this.pos + string.length);
      if (caseFold) {
        string = string.toLowerCase();
        substring = substring.toLowerCase();
      }
      if (string == substring) {
        if (consume)
          this.pos += string.length;
        return true;
      }
      return false;
    },
    findNext: function(pattern, groupNumber) {
      var currentPos = this.pos;
      this.eatWhile(/[^>]/);
      this.next();
      var nextPos = this.pos;
      this.pos = currentPos;
      var token = this.substream(nextPos - currentPos);
      var captureGroups = token.match(pattern);
      this.pos = currentPos;
      if(captureGroups) {
        return captureGroups[groupNumber];
      }
      return false;
    },
    replace: function(s, e, term, replacement) {
      this.text = this.text.substring(0,s) + replacement + this.text.substring(e);
      this.pos += replacement.length - term.length;
    }
  };


  // ### CSS Parsing
  //
  // `CSSParser` is our internal CSS token stream parser object. This object
  // has references to the stream, as well as the HTML DOM builder that is
  // used by the HTML parser.
  function CSSParser(stream, domBuilder) {
    this.stream = stream;
    this.domBuilder = domBuilder;
    this.rewrite = "";
  }

  CSSParser.prototype = {
    parse: function() {
      this.stream
      this.rules = [];
      this.comments = [];
      this._parseSelector();
    },

    // #### CSS Comment Parsing
    //
    // Here we record the position of comments in *term* in the instance's
    // comment list, and return *term* with all its comments stripped.
    stripComments: function(term, startPos) {
      var pos,
          last = term.length,
          commentStart, commentEnd,
          prev, next,
          stripped = "";
      for (pos=0; pos < last; pos++) {
        if (term[pos] === '/' && pos<last-1 && term[pos+1] === '*') {
          commentStart = startPos + pos;
          pos += 3;
          while(pos < last-1 && term.substr(pos-1,2) !== "*/") {
            pos++;
          }
          if (pos >= last-1 && term.substr(pos-1,2) !== "*/")
            throw new ParseError("UNTERMINATED_CSS_COMMENT", commentStart);
          commentEnd = startPos + pos + 1;
          this.comments.push({start: commentStart, end: commentEnd});
        } else {
          stripped += term[pos];
        }
      }
      return stripped.trim();
    },
    // #### CSS Comment Filtering
    //
    // Here we filter a token so that its start and end positions
    // point to the content without leading and trailing comments,
    // with comments in the token.value completely removed.
    filterComments: function(token) {
      var text = token.value,
          tsize = text.length,
          ntsize,
          stripped = this.stripComments(text, token.interval.start);
      // strip leading comments
      text = text.replace(/^\s+/,"");
      text = text.replace(/^\/\*[\w\W]*?\*\/\s*/,'');
      ntsize = text.length;
      token.interval.start += tsize - ntsize;
      // strip trailing comments (=reverse and repeat previous)
      tsize = ntsize;
      text = text.split('').reverse().join('');
      text = text.replace(/^\s+/,"");
      text = text.replace(/^\/\*[\w\W]*?\*\/\s*/,'');
      // FIXME: this still fails comments like this: /* ... /* ... */,
      //        which is a single block. The problems is that in the
      //        reversed string this looks like /* ... */ ... */ which
      //        counts as one block plus left-over junk.
      ntsize = text.length;
      token.interval.end -= tsize - ntsize;
      // commit text change
      token.value = stripped;
    },
    // #### CSS Selector Parsing
    //
    // A selector is a string, and terminates on `{`, which signals
    // the start of a CSS property/value pair (which may be empty).
    //
    // There are a few characters in selectors that are an immediate error:
    //
    // * `;`  Rule terminator (ERROR: missing block opener)
    // * `}`  End of css block (ERROR: missing block opener)
    // * `<`  End of `<style>` element, start of `</style>`
    //   (ERROR: css declaration has no body)
    //
    // Note that we cannot flag `:` as an error because pseudo-classes use
    // it as their prefix.
    _parseSelector: function() {
      // Depending on our state, we may be coming from having just parsed
      // a rule. If that's the case, add it to our list of rules.
      if (this.currentRule) {
        this.rules.push(this.currentRule);
        this.currentRule = null;
      }

      // Gobble all characters that could be part of the selector.
      this.stream.eatCSSWhile(/[^\{;\}<]/);
      var token = this.stream.makeToken(),
          peek = this.stream.peek();

      // If there was nothing to select, we're either done,
      // or an error occurred.
      if (token === null) {
        if (!this.stream.end() && this.stream.peek() === '<') {
          // if this is the start of <!-- make sure to throw an error
          if (this.stream.substream(2) !== "</") {
            throw new ParseError("HTML_CODE_IN_CSS_BLOCK", this, this.stream.pos-1, this.stream.pos);
          }
          return;
        }
        if(this.stream.substream().trim() ==="") {
          return;
        }
        throw new ParseError("MISSING_CSS_SELECTOR", this, this.stream.pos-1, this.stream.pos);
      }

      // If we get here, we have a selector string.
      // Filter the token for comments before continueing.
      this.filterComments(token);
      var selector = token.value,
          selectorStart = token.interval.start,
          selectorEnd = token.interval.end;

      if (selector === '') {
        this._parseSelector();
        return;
      }

      // Now we'll set up a ruleset object for this selector.
      this.currentRule = {
        selector: {
          value: selector,
          start: selectorStart,
          end: selectorEnd
        },
        declarations: {
          start: null,
          end: null,
          properties: []
        }
      };

      // Now we start to analyse whether we can continue,
      // or whether we're in a terminal state, based on the
      // next character in the stream.
      if (this.stream.end() || peek === '<') {
        throw new ParseError("UNFINISHED_CSS_SELECTOR", this, selectorStart, selectorEnd, selector);
      }

      if (!this.stream.end()) {
        var next = this.stream.next(),
            errorMsg = "[_parseSelector] Expected {, }, ; or :, " +
                       "instead found " + next;
        if (next === '{') {
          // The only legal continuation after a selector is the opening
          // `{` character. If that's the character we see, we can mark the
          // start of the declarations block and start parsing them.
          this.currentRule.declarations.start = this.stream.pos-1;
          this._parseDeclaration(selector, selectorStart);
        } else if (next === ';' || next === '}') {
          // Otherwise, this is a parse error; we should have seen `{`
          // instead.
          throw new ParseError("MISSING_CSS_BLOCK_OPENER", this, selectorStart, selectorEnd, selector);
        } else {
          // We get here if an unexpected character was found.
          throw new ParseError("UNCAUGHT_CSS_PARSE_ERROR", this, token.interval.start, token.interval.end, errorMsg);
        }
      } else {
        // If the stream ended after the selector, we want the user to follow
        // up with `{`.
        throw new ParseError("MISSING_CSS_BLOCK_OPENER", this, selectorStart, selectorEnd, selector);
      }
    },
    // #### CSS Declaration Parsing
    //
    // A declaration is a `property: value;` pair. It can be empty,
    // in which case the next character must be `}`.
    _parseDeclaration: function(selector, selectorStart, value) {
      // First, we forward the stream to the next non-space character.
      this.stream.markTokenStartAfterSpace();
      var peek = this.stream.peek();
      if (peek === '}') {
        // If the next character is `}` then this is an empty block, and we
        // should move on to trying to read a new selector ruleset.
        this.stream.next();
        this.currentRule.declarations.end = this.stream.pos;
        this.stream.markTokenStartAfterSpace();
        this._parseSelector();
      }
      // Administratively important: there are two ways for this function
      // to have been called. One is from `_parseSelector()`, which is
      // "the normal way", the other from `_parseValue()`, after finding a
      // properly closed `property:value;` pair. In this case *value* will be
      // the last declaration's value, which will let us throw a sensible
      // debug error in case the stream is empty at this point, or points to
      // `</style>`.
      else if (value && (this.stream.end() || peek === '<')) {
        throw new ParseError("MISSING_CSS_BLOCK_CLOSER", this, selectorStart, selectorStart+value.length, value);
      }

      // If we're still in this function at this point, all is well
      // and we can move on to property parsing.
      else {
        this._parseProperty(selector, selectorStart);
      }
    },
    // #### CSS Property Parsing
    // There is a fixed list of CSS properties, and we must check two things:
    //
    // 1. Does the token string contain a syntax-legal property?
    // 2. Is that property in the set of known ones?
    //
    // Properties are terminated by `:`, but we might also see the following
    // characters, which should signal an error:
    //
    // * `;` rule terminator (ERROR: missing value)
    // * `}` end of CSS block (ERROR: missing value)
    // * `<` end of `<style>` element, start of `</style>`
    //   (ERROR: missing value)
    _parseProperty: function(selector, selectorStart) {
      this.stream.eatCSSWhile(/[^\{\}<;:]/);
      var token = this.stream.makeToken();

      if (token === null) {
        throw new ParseError("MISSING_CSS_PROPERTY", this, selectorStart, selectorStart + selector.length, selector);
      }

      this.filterComments(token);
      var property = token.value,
          propertyStart = token.interval.start,
          propertyEnd = token.interval.end;

      // replace right/left
      var replaced = false;
      if(property.indexOf("right")>-1) { replaced = property.replace("right", "left"); }
      else if(property.indexOf("left")>-1) { replaced = property.replace("left", "right"); }
      if(replaced) {
        this.stream.replace(propertyStart, propertyEnd, property, replaced);
        property = replaced;
      }

      if (property === '') {
        this._parseDeclaration(selector, selectorStart);
        return;
      }

      var next = this.stream.next(),
          errorMsg = "[_parseProperty] Expected }, {, <, ; or :, " + "instead found " + next;

      if (next === '{') {
        throw new ParseError("MISSING_CSS_BLOCK_CLOSER", this, selectorStart, propertyStart, selector);
      }


      if ((this.stream.end() && next !== ':') || next === '<' ||
          next === '}') {
        throw new ParseError("UNFINISHED_CSS_PROPERTY", this, propertyStart, propertyEnd, property);
      }

      // We record `property: value` pairs as we run through the stream,
      // which are added to the set of `property: value` pairs in the
      // instance's `rules.properties` array. The push happens when we have a
      // clean run in `_parseValue()`.
      this.currentProperty = {
        name: {
          value: property,
          start: propertyStart,
          end: propertyEnd
        }
      };

      // If we find a colon, we have a property and now need a value to go
      // along with it.
      if (next === ':') {
        this.stream.markTokenStartAfterSpace();
        this._parseValue(selector, selectorStart, property, propertyStart);
      }
      // Otherwise, anything else at this point constitutes an error.
      else if (next === ';') {
        throw new ParseError("MISSING_CSS_VALUE", this, propertyStart, propertyEnd, property);
      }
      else {
        throw new ParseError("UNCAUGHT_CSS_PARSE_ERROR", this, token.interval.start, token.interval.end, errorMsg);
      }
    },
    // #### CSS Value Parsing
    //
    // A value must end either in `;` or in `}`. However, we may also find:
    //
    // * `<` end of `<style>` element, start of `</style>`
    //   (ERROR: missing block closer)
    _parseValue: function(selector, selectorStart, property, propertyStart) {
      var rule = this.stream.eatCSSWhile(/[^}<;]/),
          token = this.stream.makeToken();

      if(token === null) {
        throw new ParseError("MISSING_CSS_VALUE", this, propertyStart, propertyStart+property.length, property);
      }

      var next = (!this.stream.end() ? this.stream.next() : "end of stream"),
          errorMsg = "[_parseValue] Expected }, <, or ;, instead found "+next;


      this.filterComments(token);
      var value = token.value,
          valueStart = token.interval.start,
          valueEnd = token.interval.end;

      if (value === '') {
        throw new ParseError("MISSING_CSS_VALUE", this, this.stream.pos-1, this.stream.pos);
      }

      // Swap left/right strings
      var replaced = false;
      if(value.indexOf("right")>-1) { replaced = value.replace("right", "left"); }
      else if(value.indexOf("left")>-1) { replaced = value.replace("left", "right"); }
      if(replaced) {
        this.stream.replace(valueStart, valueEnd, value, replaced);
        value = replaced;
      }

      // Swap left/right quad values
      if(property === "padding" || property === "margin") {
        var compounds = value.trim().split(/\s+/);
        if(compounds.length===4) {
          var dims = true;
          compounds.forEach(function(t) {
            dims = dims & (t.match(/^(0|\d+\w\w)$/) !== null);
          });
          if(dims) {
            var _ = compounds[1];
            compounds[1] = compounds[3];
            compounds[3] = _;
            this.stream.replace(valueStart, valueEnd, value, compounds.join(' '));
          }
        }
      }

      // At this point we can fill in the *value* part of the current
      // `property: value;` pair. However, we hold off binding it until
      // we are sure there are no parse errors.
      this.currentProperty.value = {
        value: value,
        start: valueStart,
        end: valueEnd
      };

      if ((this.stream.end() && next !== ';') || next === '<') {
        throw new ParseError("UNFINISHED_CSS_VALUE", this, valueStart, valueEnd, value);
      }

      if (next === ';') {
        // This is normal CSS rule termination; try to read a new
        // property/value pair.
        this._bindCurrentRule();
        this.stream.markTokenStartAfterSpace();
        this._parseDeclaration(selector, valueStart, value);
      }
      else if (next === '}') {
        // This is block level termination; try to read a new selector.
        this.currentRule.declarations.end = this.stream.pos;
        this._bindCurrentRule();
        this.stream.markTokenStartAfterSpace();
        this._parseSelector();
      }
      else {
        throw new ParseError("UNCAUGHT_CSS_PARSE_ERROR", this, token.interval.start, token.interval.end, errorMsg);
      }
    },
    // This helper function binds the currrent `property: value` object
    // in the current ruleset, and resets it for the next selector block.
    _bindCurrentRule: function() {
      this.currentRule.declarations.properties.push(this.currentProperty);
      this.currentProperty = null;
    }
  };

  // ### Exported Symbols
  //
  // `Slowparse` is the object that holds all exported symbols from
  // this library.
  var CSSParse = {
    Stream: Stream,
    flip: function(cssText) {
      var stream = new Stream(cssText);
      var parser = new CSSParser(stream);
      var success = parser.parse();
      return parser.stream.text;
    }
  };

  // AMD context
  if (typeof define !== "undefined") {
    define(function() { return CSSParse; });
  }

  // Node.js context
  else if(typeof module !== "undefined" && module.exports) {
    module.exports = CSSParse;
  }

  // browser context
  else if (typeof window !== "undefined") {
    window.CSSParse = CSSParse;
  }
}());
