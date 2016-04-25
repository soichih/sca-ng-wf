(function() {
    'use strict';
    var wf = angular.module('sca-wf', [
        //'sca-shared.menu',
        //'toaster',
        'ngFileUpload', //for scaWfUploader
    ]);

    //displays task status, and if there is any dependencies, it displays that as well
    //TODO - load progress info
    //TODO - right now it only supports the end task and its dependencies. I need to support more complex dependencies
    wf.directive('scaWfTaskdeps', function($http, toaster, $interval) {
        return {
            restrict: 'E',
            //transclude: true,
            scope: {
                conf: '=', //{sca_url: , progress_url}
                taskid: '=', 
            },
            //templateUrl: (scaSharedConfig.shared_url||"../shared")+'/t/menutab.html', 
            templateUrl: 'bower_components/sca-wf/ui/t/deps.html',  //TODO - should make this configurable..
            link: function ($scope, element) {

                $scope.deps = [];
                $scope.show_debug = {}; //contains task ids to show details
                $scope.task = {};

                start_loading();
                var t;
                function start_loading() {
                    console.log("start_loading");
                    load();
                    t = $interval(load, 2500); //2.5 seconds short enough?
                }
                function stop_loading() {
                    console.log("stop_loading");
                    $interval.cancel(t); 
                    t = null;
                }

                function load() {
                    console.log("loading..");
                    $http.get($scope.conf.sca_api+'/task/', {params: {
                        where: {_id: $scope.taskid},
                    }})
                    .then(function(res) {
                        //let's not wipte the task each time I load this.. I am injecting _progress and other things, so wiping will cause flickering
                        //$scope.task = res.data[0];
                        for(var k in res.data[0]) $scope.task[k] = res.data[0][k];

                        var status = $scope.task.status;
                        if(status == "finished" || status == "failed" || status == "stopped") {
                            stop_loading();
                        } else {
                            load_progress($scope.task);
                        }

                        if(status == "finished") {
                            $scope.$emit('task_finished', $scope.task);
                        }
                          
                        //load all deps tasks
                        $scope.task.deps.forEach(function(dep_taskid, idx) {
                            $http.get($scope.conf.sca_api+'/task/', {params: { where: {_id: dep_taskid} }}).then(function(res) {
                                $scope.deps[idx] = res.data[0];
                                var status = res.data[0].status;
                                if(status != "finished" && status != "failed" && status != "stopped") {
                                    load_progress(red.data[0]);
                                }
                            }, function(res) {
                                if(res.data && res.data.message) toaster.error(res.data.message);
                                else toaster.error(res.statusText);
                            })
                        });
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

                function load_progress(task) {
                    $http.get($scope.conf.progress_api+'/status/'+$scope.task.progress_key)
                    .then(function(res) {
                        task._progress = res.data; 
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

                $scope.$on("$destroy", function(event) {
                    console.log("destroying taskdeps");
                    stop_loading();
                });

                /*
                scope.$watch('user', function() {
                    init_menu(scope, scope.menu);
                });
                scope.go = function(url) {
                    document.location = url;
                };
                */
                $scope.stop = function(task) {
                    $http.put($scope.conf.sca_api+"/task/stop/"+task._id)
                    .then(function(res) {
                        toaster.success("Requested to stop this task");
                        //stop_loading();
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

                $scope.rerun = function(task) {
                    $http.put($scope.conf.sca_api+"/task/rerun/"+task._id)
                    .then(function(res) {
                        toaster.success("Requested to rerun this task");
                        start_loading();
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }

            }
        };
    });

    wf.directive('scaWfUploader', ['appconf', 'toaster', 'Upload', '$http', 
    function(appconf, toaster, Upload, $http ) {
        return {
            //restrict: 'E',
            scope: {
                instid: '=',
                taskid: '=',
                files: '=',
            }, 
            templateUrl: 'bower_components/sca-wf/ui/t/uploader.html', //TODO should be made configurable somehow
            link: function(scope, element) {
                scope.loaded = false;

                //first find the best resource to upload files to
                var best_resource = null;
                $http.get(appconf.sca_api+"/resource/best", {params: {
                    service_id: "_upload",
                }})    
                .then(function(res) {
                    best_resource = res.data;
                    
                    //then download files that are already uploaded to the resource
                    $http.get(appconf.sca_api+"/resource/ls", {params: {
                        resource_id: best_resource.resource._id,
                        path: best_resource.workdir+"/"+scope.instid+"/"+scope.taskid,
                    }})    
                    .then(function(res) {
                        scope.loaded = true;
                        scope.files = res.data.files;
                        console.log("files loaded");
                        console.dir(scope.files);
                    }, function(res) {
                        scope.loaded = true;
                        if(res.data && res.data.code && res.data.code == 2) {
                            console.log("upload directory doesn't exist yet, but that's ok");
                            scope.files = [];
                            return;
                        }
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else toaster.error(res.statusText);
                    });
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });

                scope.newfiles = [];
                scope.$watch('newfiles', function() {
                    scope.upload(scope.newfiles);
                });

                //handles the actual file upload to the best resource found
                scope.upload = function(files) {
                    if(files.length == 0) return;
                    files.forEach(function(file) {
                        file.upload = Upload.upload({
                            url: appconf.sca_api+"/resource/upload",
                            data: {
                                resource_id: best_resource.resource._id,
                                path: best_resource.workdir+"/"+scope.instid+"/"+scope.taskid,
                                file: file, 
                            }
                        });
                        file.upload.then(function(res) {
                            console.dir(res.data);
                            file.complete = true;
                            scope.files.push(res.data.file);
                            scope.$emit("file_uploaded", res.data.file);
                        }, function(res) {
                            if(res.data && res.data.message) toaster.error(res.data.message);
                            else toaster.error(res.statusText);
                            file.failed = true;
                            file.progress = 0;
                        }, function(event) {
                            if(event.loaded && event.total) file.progress = parseInt(100.0 * event.loaded / event.total);
                            else file.progress = 0;
                        });
                    });
                }
                scope.remove = function(file) {
                    console.dir(file);
                    console.log("todo .. remove");
                }
                scope.download = function(file) {
                    var jwt = localStorage.getItem(appconf.jwt_id);
                    var path = best_resource.workdir+"/"+scope.instid+"/"+scope.taskid+"/"+file.filename;
                    var url = appconf.sca_api+"/resource/download?r="+best_resource.resource._id+"&p="+path+"&at="+jwt;
                    window.open(url, "_blank");
                    //window.location = url;
                    console.log("download");
                }
            }
        };
    }]);

    wf.filter('bytes', function() {
        return function(bytes, precision) {
            if (isNaN(parseFloat(bytes)) || !isFinite(bytes)) return '-';
            if (typeof precision === 'undefined') precision = 1;
            var units = ['bytes', 'kB', 'MB', 'GB', 'TB', 'PB'],
                number = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, Math.floor(number))).toFixed(precision) +  ' ' + units[number];
        }
    });

})();

