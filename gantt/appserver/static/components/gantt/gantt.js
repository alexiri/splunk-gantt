// Gantt Chart
// this displays information as a gantt chart

define(function(require, exports, module) {

    var _ = require('underscore');
    var d3 = require("./contrib/d3");
    var d3tip = require("./contrib/d3.tip");
    var SimpleSplunkView = require("splunkjs/mvc/simplesplunkview");
    var Drilldown = require('splunkjs/mvc/drilldown');
    
    require("css!./gantt.css");

    var margin = {top: 10, right: 10, bottom: 10, left: 10};

    var GanttChart = SimpleSplunkView.extend({

        className: "custom-ganttchart",

        options: {
            managerid: null,   
            data: "preview", 
            startField: null,
            endField: null,
            durationField: null,
            categoryLabel: "Category",
            categoryField: null,
            seriesLabel: "Series",
            seriesField: null,
            extrasField: null,
            drilldownField: null,
            showLegend: "true",
            compact: "false"
        },

        output_mode: "json",

        events: {
            'click': function(e) {
                e.preventDefault();
                if (this.settings.get('drilldownField')) {
                    // If we were given a drilldownField, use it
                    var data = { 
                        name:  this.settings.get('drilldownField'),
                        value: $.trim($(e.target).data('field'))
                    }
                } else {
                    // otherwise, drill down by time
                    var data = { 
                        name: '_time',
                        _span: parseInt($.trim($(e.target).data('span')))+2,
                        value: parseInt($.trim($(e.target).data('time')))-1
                    }
                }

                Drilldown.handleDrilldown(data, 'row', this.manager);
            }
        },

        initialize: function() {
            SimpleSplunkView.prototype.initialize.apply(this, arguments);

            this.settings.enablePush("value");

            this.settings.on("change:categoryField", this.render, this);
            this.settings.on("change:seriesField", this.render, this);

            // Set up resize callback. The first argument is a this
            // pointer which gets passed into the callback event
            $(window).resize(this, _.debounce(this._handleResize, 20));
        },
        
        _handleResize: function(e){

            var availableWidth  = parseInt(e.data.$el.width()) - margin.left - margin.right;
            var availableHeight = parseInt(e.data.$el.height()- margin.top - margin.bottom);

            var svg = d3.select(e.data.el)
                .select("svg")
                .attr("width", availableWidth + margin.left + margin.right)
                .attr("height", availableHeight + margin.top + margin.bottom);

            e.data._viz.height = availableHeight;
            e.data._viz.width  = availableWidth;

            e.data.render();
        },

        createView: function() {
            // Here we set up the initial view layout

            var availableWidth = parseInt(this.$el.width()) - margin.left - margin.right;
            var availableHeight = parseInt(this.$el.height()- margin.top - margin.bottom);

            this.$el.html("");

            var svg = d3.select(this.el)
                .append("svg")
                .attr("width", availableWidth + margin.left + margin.right)
                .attr("height", availableHeight + margin.top + margin.bottom)
                .append("g")
                .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
                .attr("pointer-events", "all");

            // The returned object gets passed to updateView as viz
            return { container: this.$el, svg: svg, height: availableHeight, width: availableWidth};
        },

        formatData: function(data) {
            var startField     = this.settings.get('startField');
            var endField       = this.settings.get('endField');
            var durationField  = this.settings.get('durationField');
            var categoryField  = this.settings.get('categoryField');
            var seriesField    = this.settings.get('seriesField');
            var extrasField    = this.settings.get('extrasField');
            var drilldownField = this.settings.get('drilldownField');

            var taskArray = [];

            // We need two out of these three fields, so make sure they're set
            if ((startField? 1: 0) + (endField? 1: 0) + (durationField? 1: 0) < 2) {
                this.displayMessage({
                    level: "error",
                    icon: "warning-sign",
                    message: "Must specify at least two of: startField, endField, durationField."
                });
                return false;
            }

            _(data).each(function(d) {

                try {
                    var extras = JSON.parse(d[extrasField]);
                } catch (SyntaxError) {
                    var extras = d[extrasField];
                }

                var start = new Date(isNaN(d[startField]) ? Date.parse(d[startField]) : d[startField]*1000);
                var end   = new Date(isNaN(d[endField])   ? Date.parse(d[endField])   : d[endField]*1000);
                var dur   = d[durationField];

                if (startField && durationField && !endField) {
                    end = new Date(+start+dur*1000);
                } else if (endField && durationField && !startField) {
                    start = new Date(+end-dur*1000);
                } else if (startField && endField) {
                    dur = (end-start)/1000;
                }

                // If we don't have a duration by now, skip this result                
                if (isNaN(dur)) {
                    console.warn("Unable to format event:", d);
                    return;
                }

                taskArray.push({
                    "id"        : {'time': Date.parse(d['_time'])/1000, 'span': dur, 'field': d[drilldownField]},
                    "startTime" : start,
                    "endTime"   : end,
                    "duration"  : dur,
                    "category"  : d[categoryField],
                    "series"    : d[seriesField],
                    "extras"    : extras
                })
            });

            return taskArray; // this is passed into updateView as 'data'
        },

        updateView: function(viz, data) {
            var that = this;

            var showLegend    = (this.settings.get('showLegend') === 'true');
            var compact       = (this.settings.get('compact')    === 'true');
            var categoryLabel = this.settings.get('categoryLabel');
            var seriesLabel   = this.settings.get('seriesLabel');


            if (compact) {
                var barHeight  = 5;
                var barSpacing = 1;
                var barRound   = 0;
            } else {
                var barHeight  = 20;
                var barSpacing = 4;
                var barRound   = 3;
            }
            var gap = barHeight + barSpacing;

            var width  = viz.width;
            var height = viz.height;

            // Clear svg
            var svg = $(viz.svg[0]);
            svg.empty();

            var categories = _(_(data).pluck('category')).uniq().sort();
            var series     = _(_(data).pluck('series')).uniq().sort();

            // Prepare the color scale for the series
            var colorScale = d3.scale.category20()
                .domain(series);


            // First we need to make an initial Y axis, mostly to get the width right
            var y = d3.scale.ordinal()
                .domain(categories)
                .rangeRoundBands([0, categories.length*gap]);

            var yAxisBBox = makeYaxis(viz, y, gap, categoryLabel);


            // Now make the X axis
            var x = d3.time.scale()
                .domain([d3.min(data, function(d) {return d.startTime;}),
                         d3.max(data, function(d) {return d.endTime;})])
                .range([0, width - yAxisBBox.width - margin.left]);

            var xAxis = viz.svg.append("g")
                .attr("id", "xAxis")
                .attr("class", "axis");

            // Figure out how many ticks we want based on the space available (the 70 is a heuristic value)
            var ticks = Math.ceil((width - yAxisBBox.width - margin.left)/70);

            xAxis.call(d3.svg.axis()
                        .scale(x)
                        .tickSubdivide(true)
                        .ticks(ticks)
                        .orient("bottom"));

            xAxis.append("text")
                    .text("Time")
                    .attr("class", "title")
                    .attr("x", function(d) {
                        var xAxisBBox = viz.svg.select("#xAxis")[0][0].getBBox();
                        return (xAxisBBox.width + this.getBBox().width) / 2;
                    })
                    .attr("y", function(d) {
                        var xAxisBBox = viz.svg.select("#xAxis")[0][0].getBBox();
                        return xAxisBBox.height + 5;
                    });
            

            // Create the tooltip
            var tip = d3tip()
                .attr('class', 'd3-tip')
                .offset([-10, 0])
                .html(function(d) {
                    var tag = "<table>" +
                        "<tr><td>Start time</td><td>" + dateStr(d.startTime) + "</td></tr>" +
                        "<tr><td>End time</td><td>" + dateStr(d.endTime) + "</td></tr>" +
                        "<tr><td>Duration</td><td>" + durationStr(d.duration) + "</td></tr>" +
                        "<tr><td>" + seriesLabel + "</td>" +
                            "<td style='color: " + d3.rgb(colorScale(d.series)) + "'>" + d.series + "</td></tr>" +
                        "<tr><td>" + categoryLabel + "</td><td>" + d.category + "</td></tr>";
                    if (_.isObject(d.extras)) {
                        for (k in d.extras) { 
                            tag += "<tr><td>" + k + "</td><td>" + d.extras[k] + "</td></tr>";
                        }
                    } else if (_.isString(d.extras)) {
                        tag += "<tr><td colspan='2'>" + d.extras + "</td></tr>";
                    }

                    return tag + "</table>";
            })
            viz.svg.call(tip);


            
            //Create the legend
            if (showLegend) {
                var keyPadding = {top: 2, right: 10, bottom: 2, left: 10, spacing: 10};

                var rectangles = viz.svg.append('g')
                    .attr("id", "legend")
                    .attr("class", "legend")
                    .selectAll("rect")
                    .data(series)
                    .enter()
                        .append("g");

                var text = rectangles.append("text")
                    .text(function(d) { return d; })
                    .attr("x", function(d, i) { 
                        var x = keyPadding.left;
                        if (this.parentElement.previousSibling) {
                            var prevBox = d3.select(this.parentElement.previousSibling)[0][0].getBBox();
                            x += prevBox.x + prevBox.width + keyPadding.right + keyPadding.spacing;
                        }
                        return x;
                    })
                    .attr("y", function(d) { return this.getBBox().height + keyPadding.top - keyPadding.bottom*2; })
                    .attr("fill", "white")
                    .attr("text-anchor", "start");

                var rects = rectangles.insert("rect", "text")
                    .attr("rx", 3)
                    .attr("ry", 3)
                    .attr("x", function(d) {
                        var x = 0;
                        if (this.parentElement.previousSibling) {
                            var prevBox = d3.select(this.parentElement.previousSibling)[0][0].getBBox();
                            x += prevBox.width + keyPadding.right + keyPadding.spacing;
                        }
                        return x;
                    })
                    .attr("y", 0)
                    .attr("width", function(d) { 
                        var textBBox = d3.select(this.parentElement).select("text")[0][0].getBBox();
                        return textBBox.width + keyPadding.left + keyPadding.right;
                    })
                    .attr("height", function(d) { 
                        var textBBox = d3.select(this.parentElement).select("text")[0][0].getBBox();
                        return textBBox.height + keyPadding.top + keyPadding.bottom;
                    })
                    .attr("fill", function(d) { return d3.rgb(colorScale(d)); });
            }



            // Now, finally, add the data
            var dataArea = viz.svg.append("g")
                .attr("class", "data")
                .attr("transform", "translate(" + yAxisBBox.width + ", " + (barSpacing/2) + ")");

            var actualRange = [];
            _(categories).each(function(c) {
                var cData = _(_(data).where({ 'category': c })).sortBy(function(d) { return -d.duration; });

                dataArea.append("g")
                    .attr("class", "layer")
                    .attr("x", 0)
                    .attr("y", function(d) {
                        var y = 0;
                        if (this.previousSibling) {
                            var prevBox = d3.select(this.previousSibling)[0][0].getBBox();
                            y += prevBox.y + prevBox.height + barSpacing*2;
                        }

                        actualRange.push(y);
                        return y;
                    })
                    .selectAll(".bar")
                    .data(cData)
                    .enter().append("rect")
                        .attr("class", "bar")
                        .attr("data-time", function(d) { return d.id.time; })
                        .attr("data-span", function(d) { return d.id.span; })
                        .attr("data-field", function(d) { return d.id.field; })
                        .attr("rx", barRound)
                        .attr("ry", barRound)
                        .attr("x", function(d) { return x(d.startTime); })
                        .attr("width", function(d) { return x(d.endTime)-x(d.startTime); })
                        .attr("height", barHeight)
                        .attr("y", function(d) {
                            var yPos = parseInt(this.parentNode.getAttribute("y"));

                            // Get previous siblings
                            var prevs = [];
                            var elem = this;
                            while(elem = elem.previousSibling) { prevs.push(elem); }

                            if (prevs) {
                                var myBox = this.getBBox();
                                var me = { left: myBox.x, top: yPos,   right: myBox.x + myBox.width, bottom: yPos + myBox.height   }

                                var clean = false;
                                while(!clean) {
                                    var i;
                                    for(i = 0; i < prevs.length; i++) {
                                        var pBox = prevs[i].getBBox();
    
                                        var p  = { left: pBox.x,  top: pBox.y, right: pBox.x + pBox.width,   bottom: pBox.y + myBox.height }

                                        if (overlap(me, p)) {
                                            // Move to the next row down and try again
                                            yPos = me.bottom + barSpacing;
                                            me.top = yPos;
                                            me.bottom = yPos + myBox.height;
                                            break;
                                        }
                                    }
                                    if (i == prevs.length) {
                                        // If we made it all the way through the for, we didn't overlap with anyone
                                        clean = true;
                                    }
                                }
                            }

                            return yPos;
                        })
                        .attr("fill", function(d) { return d3.rgb(colorScale(d.series)); })
                        .on('mouseover', tip.show)
                        .on('mouseout', tip.hide);
            });
   

            // Now that all that's done, we can go make the real Y Axis, because we know the actual position of each layer 
            var lastLayer = _(dataArea.selectAll(".layer")[0]).last().getBBox();
            actualRange.push(lastLayer.y + lastLayer.height + barSpacing*2);

            y = d3.scale.ordinal()
                .domain(categories)
                .range(actualRange);

            // Out with the old...
            viz.svg.select("#yAxis").remove();
            // ... in with the new
            yAxisBBox = makeYaxis(viz, y, gap, categoryLabel);

            // Move the X axis to it's place
            xAxis.attr("transform", "translate(" + yAxisBBox.width + ", " + yAxisBBox.height + ")");

            if (showLegend) {
                // Now move the legend to it's place 
                var xAxisBBox = viz.svg.select("#xAxis")[0][0].getBBox();
                var center = yAxisBBox.width + xAxisBBox.width/2 - viz.svg.select("#legend")[0][0].getBBox().width/2
                viz.svg.select("#legend").attr("transform", "translate(" + center + ", " + (yAxisBBox.height + xAxisBBox.height + margin.bottom) + ")");
            }


            // Now that we know how big the chart is, we can set the real height
            svg.parent().attr("height", viz.svg.node().getBBox().height + margin.top + margin.bottom);
        }

    });

    function makeYaxis(viz, y, gap, categoryLabel) {

        var yAxis = viz.svg.append("g")
            .attr("id", "yAxis")
            .attr("class", "axis");
            
        yAxis.call(d3.svg.axis().scale(y).orient("left"))
            .append("text");
            
        // Move the category labels down to the middle of the first row
        yAxis.selectAll(".tick text")
            .attr("y", function(d) {
                return Math.max(gap/2, this.getBBox().height/2);
        });

        // If we have a categoryLabel other than the default, label the axis
        if (categoryLabel != "Category") {
            yAxis.append("text")
                .text(categoryLabel)
                .attr("class", "title")
                .attr("transform", function(d) {
                    return "rotate(-90)" 
                })
                .attr("x", function(d) {
                    var yAxisBBox = viz.svg.select("#yAxis")[0][0].getBBox();
                    return -(yAxisBBox.height + this.getBBox().height) / 2;
                })
                .attr("y", function(d) {
                    var yAxisBBox = viz.svg.select("#yAxis")[0][0].getBBox();
                    return -yAxisBBox.width - 10;
                });
        }
        
        // Move the Y axis into position
        var yAxisBBox = viz.svg.select("#yAxis")[0][0].getBBox();
        viz.svg.select("#yAxis").attr("transform", "translate(" + yAxisBBox.width + ", 0)");

        return yAxisBBox;
    }

    function dateStr(d) {
        var str = $.datepicker.formatDate('M d, yy', d);

        if (0 != d.getHours() || 0 != d.getMinutes() || 0 != d.getSeconds()) {
            if (0 == d.getSeconds()) {
                str += ' ' + d.toTimeString().substr(0, 5);
            } else {
                str += ' ' + d.toTimeString().substr(0, 8);
            }
        }

        return str;
    }

    function durationStr(t) {

        var days    = parseInt(t / 86400);
        var hours   = parseInt(t / 3600)  % 24;
        var minutes = parseInt(t / 60)    % 60;
        var seconds = t % 60;

        return (days    > 0 ? ("0" + days   ).slice(-2) + "d " : "") + 
               (hours   > 0 ? ("0" + hours  ).slice(-2) + "h " : "") + 
               (minutes > 0 ? ("0" + minutes).slice(-2) + "m " : "") + 
               (seconds > 0 ? ("0" + seconds).slice(-2) + "s"  : "");
    }

    function overlap(a, b) {
        return a.left <= b.right  && 
               b.left <= a.right  &&
               a.top  <  b.bottom &&
               b.top  <  a.bottom;
    }

    return GanttChart;
});
