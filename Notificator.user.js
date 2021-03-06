// ==UserScript==
// @name         Notificator
// @namespace    https://bitbucket.org/vbelozyorov/phab-notificator
// @version      0.9.7.%BUILD_TIME%
// @description  Polls Phabricator notifications endpoint and shows unread notifications on desktop
// @author       Vladimir Belozyorov
// @match        https://phab.shire.local/*
// @grant        none
// @downloadURL  https://bitbucket.org/vbelozyorov/phab-notificator/downloads/Notificator.user.js
// @updateURL    https://bitbucket.org/vbelozyorov/phab-notificator/downloads/Notificator.user.js
// @supportURL   https://bitbucket.org/vbelozyorov/phab-notificator/issues
// ==/UserScript==

(function() {
    'use strict';

    if (!("Notification" in window)) {
        console.warning("This browser does not support desktop notification. " + GM_info.script.name + " useless and won't work here.");
        return;
    }

    let heartbeatDelay = 1000 * 5;
    let mainDelay = 1000 * 15;
    let taskRenotifyDelay = 1000 * 60 * 30;
    let timestart = Date.now();
    let pause = 0;

    function heartbeat() {
        let running = {};
        let now = Date.now();
        pause = 0;
        if ('notificator-running' in localStorage ) {
            running = JSON.parse(localStorage['notificator-running']);
            //console.debug(running);
            for (let ts in running) {
                let hb = running[ts];
                if (hb < now-2*heartbeatDelay) {
                    delete running[ts];
                } else {
                    if (ts >= timestart) {
                        pause += 0;
                    } else {
                        pause += 1;
                        break;
                    }
                }
            }
        }
        running[timestart] = now;
        localStorage['notificator-running'] = JSON.stringify(running);
    }

    let requestPromise = Promise.resolve(Notification.permission);
    if (Notification.permission == 'default') {
        requestPromise = Notification.requestPermission();
    }

    let displayedMetas = new Set([]);

    /**
     * https://stackoverflow.com/a/35385518/1764747
     *
     * @param {String} HTML representing a single element
     * @return {Element}
     */
    function htmlToElement(html) {
        var template = document.createElement('template');
        html = html.trim(); // Never return a text node of whitespace as the result
        template.innerHTML = html;
        return template.content.firstChild;
    }

    /**
     * @param {String} HTML representing any number of sibling elements
     * @return {NodeList}
     */
    function htmlToElements(html) {
        var template = document.createElement('template');
        template.innerHTML = html;
        return template.content.childNodes;
    }

    function showNotification(element) {
        var taskHref = element.childNodes[2];
        var options = {
            body: element.innerText + ' <a href="' + taskHref.href + '">look</a>',
            //renotify: true
        }
        //console.debug(element);
        var notification = new Notification(taskHref.innerText, options);
    }

    function main() {
        if (pause > 0) {
            console.info(GM_info.script.name + " in this tab paused while other tab(s) running");
            return;
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/notification/panel/');
        var xhrPromise = new Promise((resolve, reject) => {
            xhr.onreadystatechange = function() { // (3)
                if (xhr.readyState != 4) return;

                if (xhr.status != 200) {
                    console.error('Notifications request failed (' + xhr.status + ': ' + xhr.statusText + ')');
                    reject();
                } else {
                    //console.debug('Notification request success');
                    resolve(xhr.responseText);
                }

            }
        });
        xhr.send();

        xhrPromise
            .then((responseText) => {
                let braceIdx = responseText.indexOf("{");
                let json = responseText.substring(braceIdx);
                let responseObj = JSON.parse(json);
                return htmlToElements(responseObj.payload.content);
            })
            .then((elements) => {
                let unread = [];
                let shown;
                if ('notificator-shown' in localStorage) {
                    shown = JSON.parse(localStorage['notificator-shown']);
                } else {
                    shown = {};
                }

                //console.debug(elements);
                let now = Date.now();
                let actualTasks = [];
                elements.forEach((elem) => {
                    if (elem.matches('.phabricator-notification-unread')) {

                        let task = elem.childNodes[2].getAttribute('href').replace('/', '');
                        actualTasks.push(task);
                        let meta = elem.dataset.meta;
                        let show = true;
                        if (task in shown) {
                            if (meta in shown[task].notifications) {
                                show = false;
                            }
                            if (now >= shown[task].renotify) {
                                shown[task].renotify += taskRenotifyDelay;
                                show = true;
                            }
                        } else {
                            shown[task] = {};
                            shown[task].renotify = now + taskRenotifyDelay;
                            shown[task].notifications = {};
                        }
                        if (show) {
                            shown[task].notifications[meta] = 1;
                            unread.push(elem);
                        }
                    }
                });

                for (let task in shown) {
                    if (actualTasks.indexOf(task) === -1) {
                        delete shown[task];
                    }
                }

                localStorage['notificator-shown'] = JSON.stringify(shown);
                return unread.reverse();
            })
            .then((unread) => {
                //console.debug(unread.length + " unread notifications");
                unread.forEach((el) => {
                    showNotification(el);
                });
                //console.debug(displayedMetas);
                if (displayedMetas.length >= 50) {
                    console.warning("You have 50 or more unread notifications. If you already surrendered, just click on top-left bell and hit 'Mark All Read' to start life from scratch ;)");
                }
            })
            .catch((reason) => {console.error(reason)})
        ;
    };

    requestPromise
        .then((permission) => {
            if (permission === 'granted') {
                //main();
                heartbeat();
                let hbInterval = setInterval(heartbeat, heartbeatDelay);
                let mainInterval = setInterval(main, mainDelay);
            } else {
                console.debug("Notifications permission is " + permission + ". " + GM_info.script.name + " can't work without permission to Notifications.");
            }
        })
        .catch((reason) => {
            console.error(reason);
        })
    ;

})();
