const crawler = {

    que             : [],
    tested          : [],
    crawling        : [],
    failed          : [],
    tests           : [],
    ignore_paths    : [],
    crawl_id        : undefined,
    linked_from     : {},
    redirects       : {},
    useragent       : 'desktop',
    event_handler   : crawler_event_handler,
    painter         : crawler_painter,

    /**
     * Register a test to run.
     *
     * @param {string} name
     * @param {string} title
     * @param {Array} headers
     * @param {*} callable
     * @returns {undefined}
     * @throws Exception
     */
    regiser_test: function(name, title, headers, callable){
        if(name == undefined || this.get_test_by_name(name)) throw 'Invalid name specified for your test';
        if(title == undefined) throw 'Title not specified';
        if(!(headers instanceof Array) || headers.length < 1) throw 'Headers array is invalid';
        if(typeof callable != 'function') return this.painter.create(name, title, headers);
        this.tests.push({name: name, title: title, callback: callable, cont: this.painter.create(name, title, headers)});
        return undefined;
    },

    /**
     * Return a registered test by name
     *
     * @param {string} name
     * @returns {object|false}
     */
    get_test_by_name: function(name){
        for(var t in this.test) if(this.tests[t]['name'] == name) return this.tests[t];
        return false;
    },

    /**
     * Check if the url passed is valid for crawling, if so and it hasn't
     * been added or crawled before, add it to the que
     *
     * Returns true|false if added to que
     *
     * @param {string} url
     * @returns {boolean}
     */
    que_url: function(url){
        var sanitized = this.sanitize(url);
        if( !this.can_crawl(url) || this.que.indexOf(sanitized) > -1 || !this.can_crawl(sanitized)) return false;
        this.que.push(sanitized);
        return true;
    },

    /**
     *  Clean up a url so it becomes relative and standardized
     *
     * @param {string} url
     * @returns {string}
     */
    sanitize: function(url){
        if(url == undefined) return '';

        url = url
            .replace(/^\/|\/$/g, '')
            .replace(/https?:\/\/[^\/]+/i, '')
            .replace(/^\/|\/$/g, '')
            .split('#')[0];

        if( url.slice(-1) == '?' ) url = url.slice(0, -1);
        if( url.length < 1 ) url = '/';

        return url;
    },

    /**
     * Get the domain for the passed url
     *
     * @param {string} url
     * @returns {string}
     */
    get_domain: function(url){
        if( !url ) return '';
        if( url.indexOf("://") > -1 ) return url.split('/')[2].split(':')[0];
        else return url.split('/')[0].split(':')[0];
    },

    /**
     * Checks if the passed url should be ignored or not
     *
     * @param {string} url
     * @returns {boolean}
     */
    ignore_url: function( url ){
        for(var regex in this.ignore_paths) {
            var reg = new RegExp(this.ignore_paths[regex], 'i');
            if( url.match(reg) != null ) return true;
        }
        return false;
    },

    /**
     * Update all ignore paths to the paths specified
     * Note: Path can be in regex format
     *
     * @param paths
     * @returns {crawler}
     */
    set_ignore_paths: function(paths){
        this.ignore_paths = paths;
        return this;
    },

    /**
     * Sets the crawl id
     *
     * @param crawl_id
     * @returns {crawler}
     */
    set_crawl_id: function(crawl_id){
        this.crawl_id = crawl_id;
        return this;
    },

    /**
     * Does some soft checks to determine if url is a valid candidate for crawling
     *
     * @param {string} url
     * @returns {boolean}
     */
    can_crawl: function(url){
        if(url == undefined) return false;
        return this.crawling.indexOf(url) < 0 && this.tested.indexOf(url) < 0 && this.que.indexOf(url) < 0 &&
                !this.is_file(url) && !this.ignore_url(url) && !this.is_external(url);
    },

    /**
     * Does a soft check for the url passed and checks if it's a file
     * by checking if it has an extension and if the extension contains 'html'
     *
     * @param {string} url
     * @returns {boolean}
     */
    is_file: function(url){
        var split = this.sanitize( url ).split( '.' );
        return split.length > 1 && split.pop().indexOf( 'html' ) < 0;
    },

    /**
     * Does some soft checking for the url passed to see if it's external
     * Note: If the url is internal but redirects to an external source, we wown't detect it here
     *
     * @param {string} url
     * @returns {boolean}
     */
    is_external: function(url){
        return !(
            url.length < 1              ||
            url[0] == '/'               ||
            url[0] == '#'               ||
            url.indexOf('://') < 0      ||
            url == this.sanitize( url ) ||
            this.get_domain( url ) == location.hostname
        );
    },

    /**
     * Checks if the href passed is an anchor link for url passed.
     *
     * @param {string} href
     * @param {string} url
     * @return {boolean}
     */
    is_anchor: function(href, url){
        return href.indexOf('#') >= 0 && this.sanitize(href) == this.sanitize(url);
    },

    /**
     * Check if that target we requested matches the response we got.
     * If not mark as a redirect and append the redirect to be crawled
     *
     * @param {string} target
     * @param {string} response
     * @return {boolean}
     */
    check_fetched_url: function(target, response){
        if(target != response){
            this.redirects[target] = response;
            this.que_url(response);
            return false;
        }

        return true;
    },

    /**
     * Checks if the string passed is an html page
     *
     * @param {string} html
     * @returns {boolean}
     */
    is_html: function(html){
        return html.indexOf('<head') > 0 && html.indexOf('<body') > 0;
    },

    /**
     * Fetch the next url from the que and run the tests on it
     */
    fetch_and_test: function(){
        if( !this.que || this.que.length < 1 || this.que.length < 1 || $.active > 2 ) return false;

        var url = this.que.pop();
        this.crawling.push(url);

        $.ajax({
            url: this.get_proxy( '/seotest/getPageData?u='+url ),
            data: { agent: this.useragent },
            accepts: 'json',
            dataType: 'json'
        })
            .done(function( result ) {
                var fetched = crawler.sanitize(result['url_fetched']);
                if( !result['headers'] || !result['body'] ) {
                    return crawler.failed_url(url);
                }else if(!crawler.check_fetched_url(url, fetched)){
                    this.skipped = true;
                    return crawler.event_handler.trigger('CRAWL_FOUND_REDIRECT', [url, fetched]);
                }else if(crawler.is_html(result['body'])){
                    var html = $(crawler.strip_img_src(result['body']));
                    crawler.fetch_links(html, url);
                    return crawler.run_tests(url, html, result['headers'], result['field_data'], result['phrases']);
                }else{
                    this.skipped = true;
                }
            })
            .fail( function(){
                return crawler.failed_url(url);
            })
            .always( function(){
                crawler.crawling.splice(crawler.crawling.indexOf(url), 1);

                if(!this.hasOwnProperty('skipped')){
                    crawler.tested.push(url);
                }

                crawler.event_handler.trigger('CRAWL_FINISHED', [url]);

                if( crawler.que.length < 1 && crawler.crawling.length < 1){
                    crawler.event_handler.trigger('ALL_CRAWLS_FINISHED', []);
                }

                return crawler.fetch_and_test();
            });
    },

    /**
     * Check for links in the html of the rendered page so we add them to the que
     * and also map how pages are linked to each other
     *
     * @param {jQuery} html
     * @param {string} url
     */
    fetch_links: function(html, url){
        $.each(html.find('a'), function(){
            var href    = $(this).attr('href'),
                link    = crawler.sanitize(href);

            crawler.que_url( href );

            if(!crawler.linked_from.hasOwnProperty(link)) crawler.linked_from[link] = [url];
            else if( crawler.linked_from[link].indexOf(url) < 0 ) crawler.linked_from[link].push(url);
        });
    },

    /**
     * Run the registered tests
     *
     * @param {string} url
     * @param {jQuery} html
     * @param {Array} headers
     * @param {Array} field_data
     * @param {Array} phrases
     * @returns {undefined}
     */
    run_tests: function(url, html, headers, field_data, phrases){
        this.event_handler.trigger('CRAWL_BEFORE_TESTS', [url]);
        for(var t in this.tests) {
            this.event_handler.trigger('before'+this.tests[t]['name'], [url, html, headers, field_data, phrases]);
            this.tests[t]['callback'].apply(this.tests[t], [url, html, headers, field_data, phrases]);
            this.event_handler.trigger('after'+this.tests[t]['name'], [url, html, headers, field_data, phrases]);
        }
        return this.event_handler.trigger('CRAWL_AFTER_TESTS', [url]);
    },

    /**
     * Strip out src=<anything> so that we avoid loading the images
     * on the pages
     *
     * @param {string} html
     * @returns {string}
     */
    strip_img_src: function(html){
        return html.replace( /(src).*?=(['|"].*?['|"])/ig, '' );
    },

    /**
     * Return the proxy url to test the passed url
     *
     * @param {string} url
     * @returns {string}
     */
    get_proxy: function(url){
        return location.protocol + '//' + location.hostname + url;
    },

    /**
     * Returns the word count for a given set of sentences or string
     *
     * @param {string|array} data
     * @returns {number}
     */
    get_word_count: function(data){
        if( typeof data === 'string' ) return data.split(' ').length;

        var count = 0;
        for( var d in data ) count += data[d].split(' ').length;
        return count;
    },

    /**
     * Set an arbitrary property on the crawler object
     *
     * @param {string} property
     * @param {string|int} key
     * @param {*} val
     * @return undefined
     */
    set_property: function(property, key, val){
        if(!this.hasOwnProperty(property)) this[property] = {};
        if(!this[property].hasOwnProperty(key)) this[property][key] = [val];
        else this[property][key].push(val);
    },

    /**
     * Add the failed url to the failed list and trigger the failed event
     *
     * @param {string} url
     * @returns {undefined}
     */
    failed_url: function(url){
        this.failed.push(url);
        return this.event_handler.trigger('CRAWL_LOAD_FAILED', [url]);
    },

    /**
     * Triggered every second
     *
     * @returns {undefined}
     */
    loop: function(){
        this.event_handler.trigger('CRAWLER_LOOP', [this]);
        this.fetch_and_test();
        return undefined;
    },

    /**
     * Start the crawler
     *
     * @param {object} settings
     * @throws Exception
     */
    init: function(settings){
        this.event_handler.trigger('BEFORE_INIT', [this]);

        if(settings.hasOwnProperty('crawl_id')) this.set_crawl_id(settings['crawl_id']);
        if(settings.hasOwnProperty('ignore_paths')) this.set_ignore_paths(settings['ignore_paths']);

        if( !this.crawl_id ) throw "crawl_id must be specified";

        this.interval = setInterval(function(){crawler.loop();}, 1000);
        this.event_handler.on('ALL_CRAWLS_FINISHED', function(){ window.clearInterval( crawler.interval ); });

        this.painter.init();
        this.event_handler.trigger('AFTER_INIT', [this]);
    }
};
